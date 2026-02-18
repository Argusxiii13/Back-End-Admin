const express = require('express');

module.exports = (deps) => {
  const router = express.Router();
  const { pool, dbPool, io, upload, sendEmailHandler, sendEmailNotif, sendEmailInvoice, generateInvoicePDF, notifyClient, notifyAdmin, emitAdminNotification, logAction, retryPgOperation, validatePassword, bcrypt, crypto, otps, nodemailer, axios } = deps;

router.use((req, res, next) => {
  if (req.url.startsWith('/api/admin/bookings/')) {
    req.url = req.url.replace('/api/admin/bookings/', '/api/admin/booking/');
  }
  next();
});

router.post("/api/generate-and-send-invoice", async (req, res) => {
  const { bookingId, officer, createdAt, pickupDate, returnDate, rentalType, name, price, role, carId, driver, clientEmail } = req.body;

  if (!bookingId || !officer || !createdAt || !pickupDate || !returnDate || !rentalType || !name || price === undefined || !clientEmail) {
      return res.status(400).json({ message: "Missing required fields" });
  }

  const invoiceData = {
    company: "AutoConnect Transport",
    contact: "otocnct@gmail.com",
    bookingOfficer: officer,
    invoiceNo: bookingId, // This is correct
    date: new Date(createdAt).toLocaleDateString(),
    dateOfTrip: `${new Date(pickupDate).toLocaleDateString()} - ${new Date(returnDate).toLocaleDateString()}`,
    driver: driver,
    unit: carId,
    guest: name,
    items: [
        {
            date: new Date(createdAt).toLocaleDateString(),
            description: rentalType === 'personal' ? "For Personal" : "For Company",
            units: calculateRentalDays(pickupDate, returnDate),
            amount: price
        }
    ]
};
  
  try {
      await sendEmailInvoice(invoiceData, clientEmail);

      res.status(200).json({ message: 'Invoice generated and sent successfully.', bookingId });
  } catch (error) {
      console.error('Error generating and sending invoice:', error);
      res.status(500).json({ message: "Error generating and sending invoice", error: error.message });
  }
});


router.get('/api/admin/booking/bookings-table', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters
  const pool = dbPool;

  try {
      const result = await pool.query(`
          SELECT * FROM bookings_view
          ORDER BY booking_id DESC;
      `);
      
      res.json(result.rows); // Send the retrieved rows as a JSON response
  } catch (error) {
      console.error('Error fetching bookings:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});


router.get('/api/admin/booking/statistics', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters
  const pool = dbPool;

  try {
      const totalBookingsQuery = `
          SELECT COUNT(*) 
          FROM bookings
      `;
      const totalCancelledBookingsQuery = `
          SELECT COUNT(*) 
          FROM bookings 
          WHERE status = $1
      `; // Assuming "Cancelled" is one of the status values
      const totalFinishedBookingsQuery = `
          SELECT COUNT(*) 
          FROM bookings 
          WHERE status = $1
      `; // Assuming "Finished" is one of the status values
      const totalPendingBookingsQuery = `
          SELECT COUNT(*) 
          FROM bookings 
          WHERE status = $1
      `; // Assuming "Pending" is one of the status values

      const totalBookings = await pool.query(totalBookingsQuery);
      const totalCancelledBookings = await pool.query(totalCancelledBookingsQuery, ['Cancelled']);
      const totalFinishedBookings = await pool.query(totalFinishedBookingsQuery, ['Finished']);
      const totalPendingBookings = await pool.query(totalPendingBookingsQuery, ['Pending']);

      res.json({
          totalBookings: totalBookings.rows[0].count,
          totalCancelledBookings: totalCancelledBookings.rows[0].count,
          totalFinishedBookings: totalFinishedBookings.rows[0].count,
          totalPendingBookings: totalPendingBookings.rows[0].count,
      });
  } catch (error) {
      console.error('Error fetching statistics:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});


router.get('/api/admin/booking/car-dropdown', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

  const pool = dbPool;

  try {
      const result = await pool.query('SELECT id, model FROM cars'); // Adjust the query as needed
      const cars = result.rows.map(car => ({
          id: car.id,
          model: car.model,
      }));
      res.json(cars);
  } catch (error) {
      console.error('Error fetching car data:', error);
      res.status(500).json({ error: 'Internal Server Error' });
  }
});


router.get('/api/admin/booking/receipt-retrieve/:bookingId', async (req, res) => {
  const bookingId = req.params.bookingId;
  const { role } = req.query; // Get the role from the query parameters

  const pool = dbPool;

  try {
    const query = `
      SELECT receipt
      FROM bookings
      WHERE booking_id = $1
    `;
    const values = [bookingId];

    const result = await pool.query(query, values);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const receiptBuffer = result.rows[0].receipt;

    const contentType = 'image/jpeg'; // Default content type

    res.set('Content-Type', contentType);
    
    res.send(receiptBuffer);
  } catch (error) {
    console.error('Error retrieving receipt:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});


router.get('/api/admin/booking/details/:bookingId', async (req, res) => {
  const bookingId = req.params.bookingId;
  const { role } = req.query; // Get the role from the query parameters

  const pool = dbPool;

  try {
      const query = `
          SELECT * FROM bookings_view
          WHERE booking_id = $1
      `;
      const values = [bookingId];

      const result = await pool.query(query, values);

      if (result.rowCount === 0) {
          return res.status(404).json({ error: 'Booking not found' });
      }

      const bookingDetails = result.rows[0]; // Assuming you want the first row

      res.json(bookingDetails);
  } catch (error) {
      console.error('Error fetching booking details:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});


router.put('/api/admin/booking/update/:bookingId', async (req, res) => {
  const bookingId = req.params.bookingId;
  const {
      car_id,
      name,
      email,
      phone,
      pickup_location,
      pickup_date,
      pickup_time,
      return_location,
      return_date,
      return_time,
      rental_type,
      status,
      additionalrequest,
      admin_id, // Extract admin details
      admin_name,
      admin_role
  } = req.body;

  try {
      const query = `
          UPDATE bookings
          SET
              car_id = $1,
              name = $2,
              email = $3,
              phone = $4,
              pickup_location = $5,
              pickup_date = $6,
              pickup_time = $7,
              return_location = $8,
              return_date = $9,
              return_time = $10,
              rental_type = $11,
              status = $12,
              additionalrequest = $13
          WHERE booking_id = $14
          RETURNING *;
      `;
      
      const values = [
          car_id,
          name,
          email,
          phone,
          pickup_location,
          pickup_date,
          pickup_time,
          return_location,
          return_date,
          return_time,
          rental_type,
          status,
          additionalrequest,
          bookingId
      ];


      const pool = dbPool;
      const result = await pool.query(query, values);

      if (result.rowCount === 0) {
          return res.status(404).json({ error: 'Booking not found' });
      }

      const updatedBooking = result.rows[0];

      const action = `Updated Booking ${bookingId}`;
      logAction(admin_id, admin_name, admin_role, action, { booking: updatedBooking });

      res.json(updatedBooking);
  } catch (error) {
      console.error('Error updating booking:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});


router.put('/api/admin/booking/notify-price', async (req, res) => {
  const { booking_id, user_id, price, admin_id, admin_name, admin_role, clientEmail} = req.body;
  const title = "Price Notification.";
  const message = `The price for your Booking:${booking_id} is ₱${price}. Would you like to proceed?`;
  const action = "Notify The User About Estimated Price";
  const titleEmail = "Your Booking Price Confirmation";
  const messageEmail = `Hello,

  We wanted to provide you with an important update regarding your booking (ID: ${booking_id}).

  Booking Price: ₱${price}

  Your requested booking is now ready for final confirmation. To proceed, please visit our website and review the complete details. Kindly complete the payment process to secure your reservation.

  If you have any questions or need assistance, don’t hesitate to reach out to us.

  Thank you for choosing AutoConnect Transport.

  Best regards,
  The AutoConnect Transport Team`;
  if (!booking_id || typeof price !== 'number') {
      return res.status(400).json({ error: 'Booking ID and price must be provided and price must be a number' });
  }
  const pool = dbPool;
  try {
      const result = await pool.query(
          'UPDATE bookings SET price = $1 WHERE booking_id = $2 RETURNING *',
          [price, booking_id]
      );

      if (result.rowCount === 0) {
          return res.status(404).json({ error: 'Booking not found' });
      }
      
      await logAction(admin_id, admin_name, admin_role, action, {booking: result.rows[0]});
      await notifyClient(booking_id, user_id, title, message, admin_role);
      await sendEmailNotif(titleEmail, messageEmail, clientEmail);

      res.status(200).json({ message: 'Price updated successfully', booking: result.rows[0] });


  } catch (error) {
      console.error('Error updating price:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});


router.get('/api/admin/booking/cars', (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

  const pool = dbPool;

  const sql = "SELECT * FROM cars";
  pool.query(sql, (err, results) => {
      if (err) {
          console.error(err);
          return res.status(500).json({ message: "Error fetching cars", error: err.message });
      }
      res.json(results.rows);
  });
});


router.put('/api/admin/booking/pending/:id', (req, res) => {
  const booking_id = req.params.id;
  const { admin_id, admin_name, admin_role, user_id, clientEmail, ...booking } = req.body;
  const action = `Change Status of Booking ${booking_id} into Pending`;
  const titleClient = "Booking Pending.";
  const messageClient = `Your Booking ${booking_id} has been put into Pending, please review it.`;
  const titleEmail = "Booking Pending: Action Required";

  const formatDate = (dateString) => {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'numeric',
          day: 'numeric'
      });
  };

  const DateBooked = formatDate(booking.created_at);
  const PickUpDate = formatDate(booking.pickup_date);
  const ReturnDate = formatDate(booking.return_date);

  const formatTime = (timeString) => {
    if (!timeString) return 'N/A'; // Handle missing time
    const [hours, minutes] = timeString.split(':'); // Split HH:mm:ss
    const hour = Number(hours);
    const minute = Number(minutes);

    const date = new Date();
    date.setHours(hour, minute, 0); // Set hours and minutes, seconds to 0

    return date.toLocaleString('en-US', {
        hour: 'numeric',
        minute: 'numeric',
        hour12: true
    });
};

  const pickupTimeFormatted = formatTime(booking.pickup_time);
  const returnTimeFormatted = formatTime(booking.return_time);

  const messageEmail = `Hello,

  We’re writing to let you know that your booking (ID: ${booking_id}) is currently marked as pending. Please review the booking details on our platform at your earliest convenience.
  Below are a few details of the said booking:
  Booking ID: ${booking_id}
  Pickup Location: ${booking.pickup_location}
  Pickup Date: ${PickUpDate}
  Pickup Time: ${pickupTimeFormatted}
  Return Location: ${booking.return_location}
  Return Date: ${ReturnDate}
  Return Time: ${returnTimeFormatted}
  Date Booked: ${DateBooked}

  If you have any questions or need assistance, don’t hesitate to reach out to us.

  Thank you for choosing AutoConnect Transport! We look forward to assisting you further.

  Best regards,
  The AutoConnect Transport Team`;

  const pool = dbPool;

  pool.query(
      'UPDATE bookings SET status = $1, cancel_fee = $2, cancel_reason = $3, cancel_date = $4, officer = $5 WHERE booking_id = $6 RETURNING *',
      ['Pending', 0, "None", null, admin_name, booking_id],
      (error, result) => {
          if (error) {
              console.error("Error confirming booking:", error);
              return res.status(500).json({ message: 'Error, Please try again.', error: error.message });
          }

          if (result.rowCount === 0) {
              return res.status(404).json({ message: 'Booking not found' });
          }

          const updatedBooking = result.rows[0];
          logAction(admin_id, admin_name, admin_role, action, { booking: updatedBooking });
          notifyClient(user_id, booking_id, titleClient, messageClient, admin_role);
          sendEmailNotif(titleEmail, messageEmail, clientEmail);

          return res.status(200).json({
              message: 'Booking status updated to Pending successfully',
              booking_id: booking_id,
              bookingDetails: updatedBooking
          });
      }
  );
});


router.put('/api/admin/booking/finish/:id', (req, res) => {
  const booking_id = req.params.id;
  const { admin_id, admin_name, admin_role, expenses, user_id, clientEmail} = req.body; // Extract expenses and admin details from the request body
  const action = `Change Status of Booking ${booking_id} into Finished`;
  const title = "Booking Finished.";
  const message = `Your Booking:${booking_id} is now marked as finished! We hope you had a great experience. Please consider leaving a feedback. Thanks for choosing us!`;
  const titleEmail = "Booking Completed: Thank You!";
  const messageEmail = `Hello,
  
  We’re excited to let you know that your booking (ID: ${booking_id}) has been successfully completed! We hope you had a fantastic experience using our service.
  
  Thank you for choosing AutoConnect Transport. We truly appreciate your trust in us and look forward to serving you again in the future.
  
  If you have any feedback or questions, please don’t hesitate to reach out.
  
  Best regards,  
  The AutoConnect Transport Team`;
  const pool = dbPool;
  pool.query(
    'UPDATE bookings SET status = $1, cancel_fee = $2, cancel_reason = $3, cancel_date = $4, expenses = $5, officer = $6 WHERE booking_id = $7 RETURNING *',
    ['Finished', 0, "None", null, expenses || 0, admin_name, booking_id], // Set expenses to 0 if not provided
    (error, result) => {
      if (error) {
        console.error("Error finishing booking:", error);
        return res.status(500).json({ message: 'Error finishing booking. Please try again.', error: error.message });
      }

      if (result.rowCount === 0) {
        return res.status(404).json({ message: 'Booking not found' });
      }

      const updatedBooking = result.rows[0];
      logAction(admin_id, admin_name, admin_role, action, { booking: updatedBooking });
      notifyClient(booking_id, user_id, title, message, admin_role);
      sendEmailNotif(titleEmail, messageEmail, clientEmail);

      return res.status(200).json({ 
        message: 'Booking has been finished successfully.', 
        bookingId: booking_id,
        bookingDetails: updatedBooking // Include the updated booking details
      });
    }
  );
});


router.put('/api/admin/booking/confirm/:id', (req, res) => {
  const booking_id = req.params.id;
  const { admin_id, admin_name, admin_role, user_id, clientEmail} = req.body; // Extract admin details from the request body
  const action = `Change Status of Booking ${booking_id} into Confirmed`;

  const title = "Booking Confirmed.";
  const message = `Great news! Your Booking:${booking_id} has been confirmed. An automated invoice will be sent to your registered email shortly.`;
  const titleEmail = "Booking Confirmed: Thank You!";
  const messageEmail = `Hello,
  
  Great news! Your booking (ID: ${booking_id}) has been successfully confirmed. We’re thrilled to have the opportunity to serve you and ensure your journey goes smoothly.
  
  If you have any questions or need assistance, feel free to contact us at any time. 
  
  Thank you for choosing AutoConnect Transport. We look forward to serving you!
  
  Best regards,  
  The AutoConnect Transport Team`;

  const pool = dbPool;
  pool.query(
    'UPDATE bookings SET status = $1, cancel_fee = $2, cancel_reason = $3, cancel_date = $4, officer =$5 WHERE booking_id = $6 RETURNING *',
    ['Confirmed', 0, "None", null, admin_name, booking_id],
    (error, result) => {
      if (error) {
        console.error("Error confirming booking:", error);
        return res.status(500).json({ message: 'Error confirming booking. Please try again.', error: error.message });
      }

      if (result.rowCount === 0) { // Use rowCount for PostgreSQL
        return res.status(404).json({ message: 'Booking not found' });
      }

      const updatedBooking = result.rows[0];
      
      logAction(admin_id, admin_name, admin_role, action, { booking: updatedBooking });
      notifyClient(booking_id, user_id, title, message, admin_role);
      sendEmailNotif(titleEmail, messageEmail, clientEmail);

      return res.status(200).json({ 
        message: 'Booking has been confirmed successfully.', 
        bookingId: booking_id,
        bookingDetails: updatedBooking // Include the updated booking details
      });
    }
  );
});


router.put('/api/admin/booking/cancel/:booking_id', async (req, res) => {
  const { booking_id } = req.params;
  const { admin_id, admin_name, admin_role, cancel_reason, user_id, clientEmail } = req.body; // Extract admin details and cancel reason from the request body
  const action = `Change status of ${booking_id} into Cancelled`;
  const title = "Booking Declined.";
  const message = `We're sorry to inform you that your Booking:${booking_id} has been declined. The reason for the decline is: ${cancel_reason}.`;
  const titleEmail = "Booking Update: Unfortunately Declined";
  const messageEmail = `Hello,
  
  We regret to inform you that your booking (ID: ${booking_id}) cannot be processed at this time. 
  
  Reason for Decline: ${cancel_reason}
  
  We understand this may be disappointing, and we sincerely apologize for the inconvenience. Our team is committed to providing the best possible service, even when we cannot accommodate a specific request.
  
  We'd be happy to help you explore alternative options or find a solution that meets your transportation needs. Please feel free to contact us for further assistance.
  
  Thank you for your understanding.
  
  Best regards,
  The AutoConnect Transport Team`;
  const pool = dbPool;
  if (!booking_id) {
    console.error('Booking ID is required.');
    return res.status(400).json({ message: 'Booking ID is required.' });
  }
  if (!cancel_reason) {
    console.error('Cancellation reason is required.');
    return res.status(400).json({ message: 'Cancellation reason is required.' });
  }

  try {
    const bookingResult = await pool.query(
      `SELECT pickup_date, price FROM bookings_view WHERE booking_id = $1`,
      [booking_id]
    );

    if (bookingResult.rowCount === 0) {
      console.warn(`No booking found for ID: ${booking_id}`);
      return res.status(404).json({ message: 'Booking not found.' });
    }

    const { pickup_date, price } = bookingResult.rows[0];
    const cancel_date = new Date(); // Get the current date
    const daysBeforePickup = (new Date(pickup_date) - cancel_date) / (1000 * 60 * 60 * 24); // Calculate difference in days

    let cancel_fee = 0;
    if (daysBeforePickup < 0) {
      cancel_fee = price; // 100% fee
    } else if (daysBeforePickup < 1) {
      cancel_fee = price * 0.50; // 50% fee
    } else if (daysBeforePickup < 7) {
      cancel_fee = price * 0.20; // 20% fee
    }
    const expenses = 0;
    const result = await pool.query(
      `UPDATE bookings_view SET status = $1, cancel_reason = $2, cancel_date = CURRENT_DATE, cancel_fee = $3, expenses = $4, officer = $5 WHERE booking_id = $6 RETURNING *`,
      ['Cancelled', cancel_reason, cancel_fee, expenses, admin_name, booking_id]
    );

    
    logAction(admin_id, admin_name, admin_role, action, { booking: result.rows[0] });
    notifyClient(booking_id, user_id, title, message, admin_role);
    sendEmailNotif(titleEmail, messageEmail, clientEmail);
    res.status(200).json({ message: 'Booking cancelled successfully.', booking: result.rows[0] });
  } catch (error) {
    console.error('Error cancelling booking:', error);
    res.status(500).json({ message: 'An error occurred while cancelling the booking.' });
  }
});


router.get('/api/admin/booking/pie-chart', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters
  const pool = dbPool;

  try {


      const result = await pool.query(`
          SELECT status, COUNT(*) AS count 
          FROM bookings 
          GROUP BY status
      `);
      
      const categoryData = result.rows.map(row => ({
          name: row.status,
          value: parseInt(row.count, 10),
      }));

      res.json(categoryData);
  } catch (error) {
      console.error('Error fetching category distribution:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});


router.get('/api/admin/booking/line-graph', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters
  const pool = dbPool;
  try {
      const result = await pool.query(`
          SELECT DATE(created_at) AS date, status, COUNT(*) AS count 
          FROM bookings_view 
          WHERE DATE(created_at) >= DATE_TRUNC('month', CURRENT_DATE)
          GROUP BY date, status
          ORDER BY date
      `);

      console.log(result.rows);
      res.json(result.rows); // Send raw data without processing
  } catch (error) {
      console.error('Error fetching booking data:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});

  return router;
};
