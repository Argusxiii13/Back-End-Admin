// Import dependencies
const express = require("express");
const { Pool } = require('pg');
const cors = require("cors");
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sendEmailHandler = require("./sendEmail.js");
const sendEmailNotif = require("./sendEmailNotif");
const { generateInvoicePDF } = require('./lib/generatePDF');
const sendEmailInvoice = require('./sendEmailInvoice.js'); // Ensure the path is correct
const allowedOrigin = process.env.ALLOWED_ORIGIN;
const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config();
const nodemailer = require("nodemailer");
const bodyParser = require('body-parser');
// Initialize Express app
const app = express();
const PORT = 5174;
const crypto = require('crypto'); // To generate random OTP
// In-memory storage for OTPs (not persistent across server restarts)
const otps = {};

// Serve static files from the 'admin' folder

app.use(express.static(path.join(__dirname, 'admin')));

// Database connection - 
//const pool = new Pool({host: "localhost", user: 'postgres', password: 'root', database: 'autoconnect', port: 5432});


const dbPool = new Pool({ connectionString: process.env.NEON_URL });



app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(cors({
  origin: allowedOrigin === '*' ? '*' : allowedOrigin
}));
app.use(bodyParser.json()); // Ensure this is included

const fileFilter = (req, file, cb) => {
  if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/jpg') {
    cb(null, true);
  } else {
    cb(new Error('Only JPEG and JPG files are allowed!'), false);
  }
};

const upload = multer({ 
  storage: multer.memoryStorage(),
  fileFilter: fileFilter
});

// Password validation function
const validatePassword = (password) => {
  const regex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d]{8,}$/;
  return regex.test(password);
};

// Example of a connection check
dbPool.connect((err) => {
  if (err) {
    console.error('Error connecting to the database:', err);
    return;
  }
  console.log('Connected to the database. This is Admin Side');
});

// Close the pool on app termination
process.on('SIGINT', () => {
  dbPool.end(() => {
    console.log('PostgreSQL connection pool closed.');
    process.exit(0);
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  
});

const logAction = async (admin_id, admin_name, admin_role, action, details) => {
  const pool = dbPool;
  const client = await pool.connect();
  
  const sanitizeValue = (value) => {
    // Return null for complex types
    if (value == null) return null;
    if (Buffer.isBuffer(value)) return null;
    
    if (typeof value === 'object') {
      // Handle arrays
      if (Array.isArray(value)) {
        return value.map(sanitizeValue).filter(v => v !== null);
      }
      
      // Handle objects by recursively sanitizing their values
      const sanitized = {};
      for (const [key, val] of Object.entries(value)) {
        const cleanVal = sanitizeValue(val);
        if (cleanVal !== null) {
          sanitized[key] = cleanVal;
        }
      }
      return Object.keys(sanitized).length > 0 ? sanitized : null;
    }
    
    // Handle strings (check for JSON strings)
    if (typeof value === 'string') {
      if (value.startsWith('{') || value.startsWith('[')) {
        try {
          JSON.parse(value);
          return null; // It's a JSON string, filter it out
        } catch {
          // Not valid JSON, keep it
          return value;
        }
      }
      return value;
    }
    
    // Keep primitive values (numbers, booleans)
    return value;
  };

  try {
    // If details is an object, sanitize it
    const processedDetails = typeof details === 'object' 
      ? sanitizeValue(details)
      : { value: sanitizeValue(details) };

    // Only log if we have some data after sanitization
    if (processedDetails && Object.keys(processedDetails).length > 0) {
      await client.query(
        'INSERT INTO audit_logs (admin_id, admin_name, admin_role, action, details) VALUES ($1, $2, $3, $4, $5::jsonb)',
        [admin_id, admin_name, admin_role, action, JSON.stringify(processedDetails)]
      );
    }
  } catch (error) {
    console.error('Error logging action:', error);
  } finally {
    client.release();
  }
};

// Middleware to send notif
const notifyClient = async (booking_id, user_id, title, message, admin_role) => {
  const pool = dbPool;
  const client = await pool.connect();

  try {
      await client.query(
          'INSERT INTO notifications_client (booking_id, user_id, title, message) VALUES ($1, $2, $3, $4)',
          [booking_id, user_id, title, message]
      );
  } catch (error) {
      console.error('Error Sending Notif', error);
  } finally {
      client.release();
  }
};

//===============================================================================================
//ADMIN VITE APIS
//===============================================================================================

// POST endpoint to generate and send an invoice
// POST endpoint to generate and send an invoice
app.post("/api/generate-and-send-invoice", async (req, res) => {
  const { bookingId, officer, createdAt, pickupDate, returnDate, rentalType, name, price, role, carId, driver, clientEmail } = req.body;

  // Validate incoming data
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
      // Use sendEmailInvoice to generate PDF and send email
      await sendEmailInvoice(invoiceData, clientEmail);

      res.status(200).json({ message: 'Invoice generated and sent successfully.', bookingId });
  } catch (error) {
      console.error('Error generating and sending invoice:', error);
      res.status(500).json({ message: "Error generating and sending invoice", error: error.message });
  }
});

app.put('/api/admin/booking/confirm/:id', (req, res) => {
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

  // Perform the query using callback
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

      // Access the updated booking details
      const updatedBooking = result.rows[0];
      
      logAction(admin_id, admin_name, admin_role, action, { booking: updatedBooking });
      notifyClient(booking_id, user_id, title, message, admin_role);
      

      // Add success response with updated booking details
      return res.status(200).json({ 
        message: 'Booking has been confirmed successfully.', 
        bookingId: booking_id,
        bookingDetails: updatedBooking // Include the updated booking details
      });
    }
  );
});



app.get("/api/generate-invoice", async (req, res) => {
  const invoiceData = {
      company: "OTOCNCT Transport Service",
      contact: "contact@example.com",
      bookingOfficer: "Jane Doe",
      invoiceNo: "INV-12345", // Hardcoded invoice number
      date: new Date().toLocaleDateString(), // Current date
      dateOfTrip: "2024-12-12", // Hardcoded date of trip
      driver: "John Smith", // Hardcoded driver
      unit: "Unit 1A", // Hardcoded unit
      guest: "Mr. Guest", // Hardcoded guest
      purchaseOrderNo: "PO-98765", // Hardcoded purchase order number
      items: [
          { date: "2024-12-01", description: "Service A", units: 2, rate: 50, amount: 100 },
          { date: "2024-12-02", description: "Service B", units: 1, rate: 75, amount: 75 }
      ]
  };

  try {
      const pdfBuffer = await generateInvoicePDF(invoiceData);

      // Set the response headers for PDF download
      res.set({
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'attachment; filename="invoice.pdf"',
          'Content-Length': pdfBuffer.length
      });

      // Send the PDF buffer as the response
      res.send(pdfBuffer);
  } catch (error) {
      console.error('Error generating PDF:', error);
      res.status(500).json({ message: "Error generating PDF", error: error.message });
  }
});
// Helper function to calculate the number of rental days
function calculateRentalDays(pickupDate, returnDate) {
  const start = new Date(pickupDate);
  const end = new Date(returnDate);
  const timeDiff = end - start;
  return Math.ceil(timeDiff / (1000 * 60 * 60 * 24)); // Convert milliseconds to days
}
// POST endpoint to generate an invoice
app.post("/api/generate-invoice", async (req, res) => {
  const { bookingId, officer, createdAt, pickupDate, returnDate, rentalType, name, price, role, carId, driver } = req.body;

  // Validate incoming data
  if (!bookingId || !officer || !createdAt || !pickupDate || !returnDate || !rentalType || !name || price === undefined) {
      return res.status(400).json({ message: "Missing required fields" });
  }

  const invoiceData = {
      company: "OTOCNCT Transport Service",
      contact: "contact@example.com",
      bookingOfficer: officer,
      invoiceNo: bookingId, // Use booking ID for invoice number
      date: new Date(createdAt).toLocaleDateString(), // Invoice creation date
      dateOfTrip: `${new Date(pickupDate).toLocaleDateString()} - ${new Date(returnDate).toLocaleDateString()}`, // Date range
      driver: driver, // Hardcoded driver
      unit: carId, // Using car_id as unit
      guest: name, // Guest name
      items: [
          {
              date: new Date(createdAt).toLocaleDateString(), // First column date
              description: rentalType === 'personal' ? "For Personal" : "For Company", // Service description
              units: calculateRentalDays(pickupDate, returnDate), // Calculate number of rental days
              amount: price // Amount
          }
      ]
  };

  try {
      // Generate PDF
      const pdfBuffer = await generateInvoicePDF(invoiceData);

      // Set response headers for PDF download
      res.set({
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="invoice_${bookingId}.pdf"`,
          'Content-Length': pdfBuffer.length,
      });

      // Send the PDF buffer as the response
      res.send(pdfBuffer);
  } catch (error) {
      console.error('Error generating PDF:', error);
      res.status(500).json({ message: "Error generating PDF", error: error.message });
  }
});




app.get('/api/admin/sales/car-details', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

  // Select the appropriate pool based on the role if necessary
  const pool = dbPool;

  try {
      const result = await pool.query('SELECT * FROM cars_view');
      const cars = result.rows;
      console.log(cars)
      res.json(cars);
  } catch (error) {
      console.error('Error fetching car data:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/dashboard/new-bookings', async (req, res) => {
  const { role } = req.query;
  const pool = dbPool;

  try {
    const currentTimestamp = new Date();
      console.log(currentTimestamp);
      const result = await pool.query(`
          SELECT COUNT(*) AS total 
          FROM bookings
          WHERE created_at = $1
      `, [currentTimestamp]);

      const newBookings = result.rows[0].total;
      res.json({ total: newBookings });
  } catch (error) {
      console.error('Error fetching new bookings:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/dashboard/new-users', async (req, res) => {
  try {
    // Get today's date in 'YYYY-MM-DD' format
    const { role } = req.query;

  // Determine which pool to use
  const pool = dbPool;
    const today = new Date().toLocaleDateString('en-CA'); // 'en-CA' gives YYYY-MM-DD format

    // Query to count new users created today
    const result = await pool.query(`
      SELECT COUNT(*) AS total 
      FROM users 
      WHERE DATE(created_at) = $1
    `, [today]);

    const newUsers = result.rows[0].total;
    res.json({ total: newUsers });
  } catch (error) {
    console.error('Error fetching new users:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/dashboard/new-feedback-count', async (req, res) => {
  try {
    const { role } = req.query;

  // Determine which pool to use
  const pool = dbPool;
    // Get today's date in 'YYYY-MM-DD' format
    const today = new Date().toLocaleDateString('en-CA'); // 'en-CA' gives YYYY-MM-DD format

    // Query to count feedback created today
    const result = await pool.query(`
      SELECT COUNT(*) AS total 
      FROM feedback 
      WHERE DATE(created_at) = $1
    `, [today]);

    const newFeedbackCount = result.rows[0].total;
    
    // Send the response
    res.json({ total: newFeedbackCount });
  } catch (error) {
    console.error('Error fetching new feedback count:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/dashboard/today-revenue', async (req, res) => {
  try {
    const { role } = req.query;

  // Determine which pool to use
  const pool = dbPool;
    // Get today's date in 'YYYY-MM-DD' format
    const today = new Date().toLocaleDateString('en-CA'); // 'en-CA' gives YYYY-MM-DD format

    // Query to calculate total revenue from bookings created today with specific statuses
    const result = await pool.query(`
      SELECT SUM(price) AS total_revenue 
      FROM bookings 
      WHERE DATE(created_at) = $1 
      AND status IN ('Finished', 'Confirmed')
    `, [today]);

    const todayRevenue = result.rows[0]?.total_revenue || 0; // Default to 0 if null
    res.json({ total: todayRevenue.toFixed(2) }); // Format to 2 decimal places
  } catch (error) {
    console.error('Error fetching today\'s revenue:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/dashboard/category-distribution', async (req, res) => {

  const { role } = req.query;
  const pool = dbPool;try {
      const today = new Date();
      const options = { year: 'numeric', month: '2-digit', day: '2-digit' };
      const formattedDate = today.toLocaleDateString('en-CA', options).split('/').reverse().join('-'); // Format as 'YYYY-MM-DD'

      const result = await pool.query(`
          SELECT status, COUNT(*) AS count 
          FROM bookings 
          WHERE DATE(created_at) = $1
          GROUP BY status
      `, [formattedDate]);
      
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

app.get('/api/admin/booking/bookings-table', async (req, res) => {
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

app.get('/api/admin/booking/statistics', async (req, res) => {
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

app.get('/api/admin/booking/car-dropdown', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

  // Select the appropriate pool based on the role
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

app.get('/api/admin/booking/receipt-retrieve/:bookingId', async (req, res) => {
  const bookingId = req.params.bookingId;
  const { role } = req.query; // Get the role from the query parameters

  // Select the appropriate pool based on the role
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

    // Determine the content type based on the binary data or assume a default
    // Here, we assume JPEG as default; adjust as necessary
    const contentType = 'image/jpeg'; // Default content type

    // Set the appropriate content type
    res.set('Content-Type', contentType);
    
    // Send the binary data as the response
    res.send(receiptBuffer);
  } catch (error) {
    console.error('Error retrieving receipt:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/booking/details/:bookingId', async (req, res) => {
  const bookingId = req.params.bookingId;
  const { role } = req.query; // Get the role from the query parameters

  // Select the appropriate pool based on the role
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

app.put('/api/admin/booking/update/:bookingId', async (req, res) => {
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

      // Log the action
      const action = `Updated Booking ${bookingId}`;
      logAction(admin_id, admin_name, admin_role, action, { booking: updatedBooking });

      res.json(updatedBooking);
  } catch (error) {
      console.error('Error updating booking:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/users/users-table', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

  // Select the appropriate pool based on the role
  const pool = dbPool;

  try {
      const result = await pool.query('SELECT * FROM users_view');
      const users = result.rows;
      res.json(users);
  } catch (error) {
      console.error('Error fetching user data:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/users/image/:user_id', async (req, res) => {
  const user_id = req.params.user_id;
  const { role } = req.query; // Get the role from the query parameters

  // Select the appropriate pool based on the role
  const pool = dbPool;

  try {
      const query = `
          SELECT userspfp
          FROM users_view
          WHERE id = $1
      `;
      const values = [user_id];

      const result = await pool.query(query, values);

      if (result.rowCount === 0) {
          return res.status(404).json({ error: 'User not found' });
      }

      const profilePictureBuffer = result.rows[0].userspfp;

      if (!profilePictureBuffer || profilePictureBuffer === 'binary data') {
          return res.status(404).json({ error: 'No profile picture found' });
      }

      // Set the appropriate content type
      const contentType = 'image/jpeg'; // Default content type, adjust as needed
      res.set('Content-Type', contentType);

      // Send the binary data as the response
      res.send(profilePictureBuffer);
  } catch (error) {
      console.error('Error retrieving profile picture:', error);
      return res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/users/statistics', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

  // Select the appropriate pool based on the role if necessary
  const pool = dbPool;

  try {
      // Total Users
      const totalUsersResult = await pool.query(`
          SELECT COUNT(*) AS total_users 
          FROM users
      `);

      // New Users Today
      const newUsersTodayResult = await pool.query(`
          SELECT COUNT(*) AS new_users_today 
          FROM users 
          WHERE created_at::date = CURRENT_DATE
      `);

      // Active Users (logged in within the last 7 days)
      const activeUsersResult = await pool.query(`
          SELECT COUNT(*) AS active_users
          FROM users
          WHERE last_log >= NOW() - INTERVAL '7 days'
      `);

      // Inactive Users (not logged in within the last 7 days)
      const inactiveUsersResult = await pool.query(`
          SELECT COUNT(*) AS inactive_users
          FROM users
          WHERE last_log < NOW() - INTERVAL '7 days'
      `);

      // Combine results
      const statistics = {
          totalUsers: parseInt(totalUsersResult.rows[0].total_users),
          newUsersToday: parseInt(newUsersTodayResult.rows[0].new_users_today),
          activeUsers: parseInt(activeUsersResult.rows[0].active_users),
          inactiveUsers: parseInt(inactiveUsersResult.rows[0].inactive_users)
      };

      res.json(statistics);
  } catch (error) {
      console.error('Error fetching user statistics:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/admin/booking/notify-price', async (req, res) => {
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

app.get('/api/admin/fleet/fleet-table', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

  // Select the appropriate pool based on the role if necessary
  const pool = dbPool;

  try {
      const result = await pool.query('SELECT * FROM cars_view');
      const cars = result.rows;
      res.json(cars);
  } catch (error) {
      console.error('Error fetching car data:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});



app.get('/api/admin/fleet/statistics', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

  // Select the appropriate pool based on the role if necessary
  const pool = dbPool;

  try {
      // Total vehicles count
      const totalVehiclesResult = await pool.query('SELECT COUNT(*) AS total_vehicles FROM cars_view');
      const totalVehicles = totalVehiclesResult.rows[0].total_vehicles;

      // Most rented vehicle (by booking count, newest first)
      const mostRentedResult = await pool.query(`
          SELECT c.plate_num AS most_rented_vehicle, 
                 COUNT(b.car_id) AS rental_count, 
                 c.created_at
          FROM cars_view c
          JOIN bookings_view b ON c.id::text = b.car_id  -- Cast c.id to text
          GROUP BY c.id, c.plate_num, c.created_at
          HAVING COUNT(b.car_id) = (
              SELECT MAX(rental_count)
              FROM (
                  SELECT COUNT(*) AS rental_count 
                  FROM bookings_view 
                  GROUP BY car_id
              ) AS rental_counts
          )
          ORDER BY c.created_at DESC
          LIMIT 1
      `);
      const mostRentedVehicle = mostRentedResult.rows[0]?.most_rented_vehicle || 'N/A';

      // Least rented vehicle (oldest with lowest bookings)
      const leastRentedResult = await pool.query(`
          SELECT c.plate_num AS least_rented_vehicle, 
                 COALESCE(rc.rental_count, 0) AS rental_count, 
                 c.created_at
          FROM cars_view c
          LEFT JOIN (
              SELECT car_id, COUNT(*) AS rental_count 
              FROM bookings_view 
              GROUP BY car_id
          ) rc ON c.id::text = rc.car_id  -- Cast c.id to text
          WHERE rc.rental_count IS NULL OR rc.rental_count = 0
          ORDER BY rental_count ASC, c.created_at ASC
          LIMIT 1
      `);
      const leastRentedVehicle = leastRentedResult.rows[0]?.least_rented_vehicle || 'N/A';

      res.json({
          totalVehicles: totalVehicles.toLocaleString(),
          mostRentedVehicle,
          leastRentedVehicle
      });
  } catch (error) {
      console.error('Error fetching fleet statistics:', error);
      res.status(500).json({ 
          error: 'Internal server error', 
          details: error.message 
      });
  }
});

app.get('/api/admin/fleet/booking-stats', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

  // Select the appropriate pool based on the role if necessary
  const pool = dbPool;

  try {
      // Total bookings
      const totalBookingsResult = await pool.query('SELECT COUNT(*) AS total_bookings FROM bookings_view');
      const totalBookings = totalBookingsResult.rows[0].total_bookings;

      // Booking status distribution
      const bookingStatusResult = await pool.query(`
          SELECT status, COUNT(*) AS count 
          FROM bookings_view 
          GROUP BY status
      `);

      // Monthly booking trend
      const monthlyBookingsResult = await pool.query(`
          SELECT 
              TO_CHAR(pickup_date, 'YYYY-MM') AS month, 
              COUNT(*) AS booking_count 
          FROM bookings_view 
          GROUP BY month 
          ORDER BY month
      `);

      res.json({
          totalBookings,
          statusDistribution: bookingStatusResult.rows,
          monthlyTrend: monthlyBookingsResult.rows
      });
  } catch (error) {
      console.error('Error fetching booking statistics:', error);
      res.status(500).json({ 
          error: 'Internal server error', 
          details: error.message 
      });
  }
});

app.get('/api/admin/fleet/vehicle-details/:id', async (req, res) => {
  const { id } = req.params;
  const { role } = req.query; // Get the role from the query parameters

  // Select the appropriate pool based on the role if necessary
  const pool = dbPool;

  try {
      // Fetch the vehicle details
      const vehicleQuery = 'SELECT * FROM cars_view WHERE id = $1';
      const vehicleResult = await pool.query(vehicleQuery, [id]);
      
      if (vehicleResult.rows.length === 0) {
          return res.status(404).json({ error: 'Vehicle not found' });
      }
      
      const vehicle = vehicleResult.rows[0];
      
      // Convert SVG image from bytea to Base64
      const responseData = {
          ...vehicle,
          image: vehicle.image ? Buffer.from(vehicle.image).toString('base64') : null
      };

      res.json(responseData);
  } catch (error) {
      console.error('Error fetching vehicle details:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/fleet/dropdowns-value', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

  // Select the appropriate pool based on the role if necessary
  const pool = dbPool;

  try {
      // Fetch distinct values for each category
      const brandsResult = await pool.query('SELECT DISTINCT brand AS text FROM cars_view');
      const modelsResult = await pool.query('SELECT DISTINCT model AS text FROM cars_view');
      const transmissionsResult = await pool.query('SELECT DISTINCT transmission AS text FROM cars_view');
      const typesResult = await pool.query('SELECT DISTINCT type AS text FROM cars_view');

      // Structure the response data
      const responseData = {
          brands: brandsResult.rows,
          models: modelsResult.rows,
          transmissions: transmissionsResult.rows,
          types: typesResult.rows
      };

      res.json(responseData);
  } catch (error) {
      console.error('Error fetching dropdown values:', error);
      res.status(500).json({ 
          error: 'Internal server error', 
          details: error.message 
      });
  }
});

app.post('/api/admin/fleet/add', async (req, res) => {
  const { 
      brand, 
      model, 
      type, 
      transmission, 
      price, 
      capacity, 
      luggage, 
      doors, 
      features, 
      description, 
      image, 
      plate_num,
      driver,
      admin_id, // Extract admin details
      admin_name,
      admin_role
  } = req.body;

  // Convert image from base64 if it's provided
  let imageBuffer = null;
  if (image) {
      imageBuffer = Buffer.from(image, 'base64');
  }

  const sql = `
      INSERT INTO cars (brand, model, type, transmission, price, 
                        capacity, luggage, doors, features, description, 
                        image, plate_num, driver)
      VALUES ($1, $2, $3, $4, $5, 
              $6, $7, $8, $9, $10, 
              $11, $12, $13)
      RETURNING id
  `;

  const values = [
      brand, 
      model, 
      type, 
      transmission, 
      price, 
      capacity, 
      luggage, 
      doors, 
      features, 
      description, 
      imageBuffer, 
      plate_num,
      driver
  ];
  const pool = dbPool;
  try {
      const result = await pool.query(sql, values);
      const platenum = result.rows[0].plate_num; // Get the inserted vehicle ID

      // Log the action
      const action = `Added Car ${platenum}`;
      logAction(admin_id, admin_name, admin_role, action, {
          brand,
          model,
          type,
          transmission,
          price,
          capacity,
          luggage,
          doors,
          features,
          description,
          plate_num,
          driver
      });

      res.status(201).json({ 
          message: 'Car added successfully!',
      });
  } catch (error) {
      console.error('Error adding car:', error);
      res.status(500).json({ 
          message: 'Error adding car',
          error: error.message // Helpful for debugging, remove in production if needed
      });
  }
});

app.get('/api/admin/sales/sales-statistics', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

  // Select the appropriate pool based on the role if necessary
  const pool = dbPool;

  try {
      // Total Revenue: Price from Confirmed and Finished bookings + Cancel Fee from Cancelled bookings
      const totalRevenueResult = await pool.query(`
        SELECT 
          SUM(CASE WHEN status IN ('Confirmed', 'Finished') THEN price ELSE 0 END) +
          SUM(CASE WHEN status = 'Cancelled' THEN cancel_fee ELSE 0 END) AS total_revenue 
        FROM bookings_view
      `);

      const totalRevenue = parseFloat(totalRevenueResult.rows[0].total_revenue) || 0;

      // Total Expenses: Only include expenses from Finished bookings
      const totalExpensesResult = await pool.query(`
        SELECT SUM(expenses) AS total_expenses 
        FROM bookings_view 
        WHERE status = 'Finished'
      `);

      const totalExpenses = parseFloat(totalExpensesResult.rows[0].total_expenses) || 0;
      const netIncome = totalRevenue - totalExpenses;

      // Cancelled Earnings: Total Cancel Fees from Cancelled bookings
      const cancelledEarningsResult = await pool.query(`
        SELECT SUM(cancel_fee) AS cancelled_earning 
        FROM bookings_view 
        WHERE status = 'Cancelled'
      `);

      // Combine results
      const salesStatistics = {
        totalRevenue,
        netIncome,
        cancelledEarning: parseFloat(cancelledEarningsResult.rows[0].cancelled_earning) || 0,
      };

      res.json(salesStatistics);
  } catch (error) {
      console.error('Error fetching sales statistics:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/sales/all-data', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

  // Select the appropriate pool based on the role if necessary
  const pool = dbPool;

  try {
      const result = await pool.query('SELECT * FROM bookings_view');
      const bookings = result.rows;
      res.json(bookings);
  } catch (error) {
      console.error('Error fetching bookings data:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/analytics/bookings-data', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

  // Select the appropriate pool based on the role if necessary
  const pool = dbPool;

  try {
      const result = await pool.query('SELECT * FROM bookings_view');
      const bookings = result.rows;
      res.json(bookings);
  } catch (error) {
      console.error('Error fetching bookings data:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/analytics/users-data', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

  // Select the appropriate pool based on the role if necessary
  const pool = dbPool;

  try {
      const result = await pool.query('SELECT * FROM users_view');
      const users = result.rows;
      res.json(users);
  } catch (error) {
      console.error('Error fetching users data:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/analytics/cars-data', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

  // Select the appropriate pool based on the role if necessary
  const pool = dbPool;

  try {
      const result = await pool.query('SELECT * FROM cars_view');
      const cars = result.rows;
      res.json(cars);
  } catch (error) {
      console.error('Error fetching cars data:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/analytics/feedback-data', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

  // Select the appropriate pool based on the role if necessary
  const pool = dbPool;

  try {
      const result = await pool.query(`
          SELECT 
              f_id, 
              user_id, 
              car_id, 
              booking_id, 
              DATE(created_at) AS created_at,  -- Extract only the date
              rating, 
              description, 
              read 
          FROM 
              feedback_view
      `);
      const feedbacks = result.rows;
      res.json(feedbacks);
  } catch (error) {
      console.error('Error fetching feedback data:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/booking/cars', (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

  // Select the appropriate pool based on the role
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

app.put('/api/admin/booking/pending/:id', (req, res) => {
  const booking_id = req.params.id;
  const { admin_id, admin_name, admin_role, user_id, clientEmail, ...booking } = req.body;
  const action = `Change Status of Booking ${booking_id} into Pending`;
  const titleClient = "Booking Pending.";
  const messageClient = `Your Booking ${booking_id} has been put into Pending, please review it.`;
  const titleEmail = "Booking Pending: Action Required";

  // Format the dates without time
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

  // Format time from military to AM/PM
  const formatTime = (timeString) => {
    if (!timeString) return 'N/A'; // Handle missing time
    const [hours, minutes] = timeString.split(':'); // Split HH:mm:ss
    const hour = Number(hours);
    const minute = Number(minutes);

    // Create a date object to format the time
    const date = new Date();
    date.setHours(hour, minute, 0); // Set hours and minutes, seconds to 0

    // Return the formatted time in 12-hour format
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

  // Perform the query using callback
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

app.put('/api/admin/booking/finish/:id', (req, res) => {
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

      // Access the updated booking details
      const updatedBooking = result.rows[0];
      logAction(admin_id, admin_name, admin_role, action, { booking: updatedBooking });
      notifyClient(booking_id, user_id, title, message, admin_role);
      sendEmailNotif(titleEmail, messageEmail, clientEmail);

      // Add success response with updated booking details
      return res.status(200).json({ 
        message: 'Booking has been finished successfully.', 
        bookingId: booking_id,
        bookingDetails: updatedBooking // Include the updated booking details
      });
    }
  );
});

app.put('/api/admin/booking/confirm/:id', (req, res) => {
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

  // Perform the query using callback
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

      // Access the updated booking details
      const updatedBooking = result.rows[0];
      
      logAction(admin_id, admin_name, admin_role, action, { booking: updatedBooking });
      notifyClient(booking_id, user_id, title, message, admin_role);
      sendEmailNotif(titleEmail, messageEmail, clientEmail);

      // Add success response with updated booking details
      return res.status(200).json({ 
        message: 'Booking has been confirmed successfully.', 
        bookingId: booking_id,
        bookingDetails: updatedBooking // Include the updated booking details
      });
    }
  );
});

app.put('/api/admin/booking/cancel/:booking_id', async (req, res) => {
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
  // Validate the booking_id and cancel_reason
  if (!booking_id) {
    console.error('Booking ID is required.');
    return res.status(400).json({ message: 'Booking ID is required.' });
  }
  if (!cancel_reason) {
    console.error('Cancellation reason is required.');
    return res.status(400).json({ message: 'Cancellation reason is required.' });
  }

  try {
    // Fetch the booking details to get pickup_date and price
    const bookingResult = await pool.query(
      `SELECT pickup_date, price FROM bookings_view WHERE booking_id = $1`,
      [booking_id]
    );

    // Check if the booking was found
    if (bookingResult.rowCount === 0) {
      console.warn(`No booking found for ID: ${booking_id}`);
      return res.status(404).json({ message: 'Booking not found.' });
    }

    const { pickup_date, price } = bookingResult.rows[0];
    const cancel_date = new Date(); // Get the current date
    const daysBeforePickup = (new Date(pickup_date) - cancel_date) / (1000 * 60 * 60 * 24); // Calculate difference in days

    // Determine the cancellation fee based on the policy
    let cancel_fee = 0;
    if (daysBeforePickup < 0) {
      // Cancellation on the rental day or no-show
      cancel_fee = price; // 100% fee
    } else if (daysBeforePickup < 1) {
      // Cancellation one day before the rental date
      cancel_fee = price * 0.50; // 50% fee
    } else if (daysBeforePickup < 7) {
      // Cancellations less than 7 days before the rental date
      cancel_fee = price * 0.20; // 20% fee
    }
    const expenses = 0;
    // Update the booking status to 'Cancelled', set the cancellation reason, cancel date, and cancel fee
    const result = await pool.query(
      `UPDATE bookings_view SET status = $1, cancel_reason = $2, cancel_date = CURRENT_DATE, cancel_fee = $3, expenses = $4, officer = $5 WHERE booking_id = $6 RETURNING *`,
      ['Cancelled', cancel_reason, cancel_fee, expenses, admin_name, booking_id]
    );

    // Log the cancellation action
    
    logAction(admin_id, admin_name, admin_role, action, { booking: result.rows[0] });
    notifyClient(booking_id, user_id, title, message, admin_role);
    sendEmailNotif(titleEmail, messageEmail, clientEmail);
    // Respond with success
    res.status(200).json({ message: 'Booking cancelled successfully.', booking: result.rows[0] });
  } catch (error) {
    console.error('Error cancelling booking:', error);
    res.status(500).json({ message: 'An error occurred while cancelling the booking.' });
  }
});

app.put('/api/admin/fleet/update/:id', async (req, res) => {

  const vehicleId = parseInt(req.params.id, 10);
  console.log(vehicleId); 
  const { 
      brand, 
      model, 
      type, 
      transmission, 
      price, 
      capacity, 
      luggage, 
      doors, 
      features, 
      description, 
      image, 
      plate_num,
      driver,
      admin_id, 
      admin_name,
      admin_role
  } = req.body;

  let imageBuffer = null;
  if (image) {
      imageBuffer = Buffer.from(image, 'base64');
  }

  const sql = `
      UPDATE cars 
      SET brand = $1, model = $2, type = $3, transmission = $4, price = $5, 
          capacity = $6, luggage = $7, doors = $8, features = $9, description = $10, 
          image = $11, plate_num = $12, driver = $13
      WHERE id = $14
      RETURNING *;  
  `;
  
  const values = [
    brand, 
    model, 
    type, 
    transmission, 
    price, 
    capacity, 
    luggage, 
    doors, 
    features, 
    description, 
    imageBuffer, 
    plate_num, 
    driver,
    vehicleId
  ];
  const pool = dbPool;
  try {
      const result = await pool.query(sql, values);
      const updatedCar = result.rows[0]; 


      // Log the action
      const action = `Updated Car ${plate_num}`;
      logAction(admin_id, admin_name, admin_role, action, { car: updatedCar });

      res.status(200).json({ 
          message: 'Car updated successfully!',
          data: updatedCar 
      });
  } catch (error) {
      console.error('Error updating car:', error);
      console.log(req.params.id);
      res.status(500).json({ 
          message: 'Error updating car',
          error: error.message  
      });
  }
});

app.post('/api/admin/login-otp', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: 'Email is required' });
  }

  try {
    // Check if the email exists in the admin users table
    const result = await dbPool.query('SELECT * FROM admin_users WHERE email = $1', [email]);

    if (result.rows.length === 0) {
      // Email not found in admin users
      return res.status(404).json({ message: 'Email not found in admin users' });
    }

    // Generate OTP
    const otp = crypto.randomInt(100000, 999999).toString(); // 6-digit OTP
    otps[email] = {
      otp: otp,
      createdAt: Date.now()
    }; 

    // Set up Nodemailer
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      pool: true,
      maxConnections: 10, // Adjust based on your needs and server capabilities
      maxMessages: 100,   // Close and recreate connection after 100 messages
    });

    // Email options
    const mailOptions = {
      from: process.env.SMTP_USER,
      to: email,
      subject: 'Admin Login OTP',
      text: `Your Admin Login OTP is: ${otp}. This OTP will expire in 10 minutes.`,
    };

    // Send the email
    await transporter.sendMail(mailOptions);

    console.log('Admin Login OTP sent successfully');
    return res.status(200).json({ message: 'OTP sent successfully' });
  } catch (error) {
    console.error('Admin Login OTP error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

app.post('/api/admin/verify-login-otp', async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
      console.log('Validation Error: Missing email or OTP');
      return res.status(400).json({ message: 'Email and OTP are required' });
  }

  try {
      const storedOtpData = otps[email]; // Retrieve stored OTP data here

      // Check if OTP exists
      if (!storedOtpData) {
          console.log(`No OTP found for email: ${email}`);
          return res.status(400).json({ message: 'No OTP found. Please request a new OTP.' });
      }

      // Check OTP expiration (10 minutes)
      const currentTime = Date.now();
      if (currentTime - storedOtpData.createdAt > 10 * 60 * 1000) {
          console.log(`OTP expired for email: ${email}`);
          delete otps[email];
          return res.status(400).json({ message: 'OTP has expired. Please request a new one.' });
      }

      // Verify OTP
      if (storedOtpData.otp === otp) {
          // Corrected line: added a comma between name and role
          const userResult = await dbPool.query('SELECT id, email, name, role FROM admin_users WHERE email = $1', [email]);

          if (userResult.rows.length === 0) {
              return res.status(404).json({ message: 'Admin user not found' });
          }

          const token = crypto.randomBytes(32).toString('hex'); // Simple token generation
          await dbPool.query('UPDATE admin_users SET last_token = $1 WHERE email = $2', [token, email]);
          delete otps[email]; // Remove OTP after successful validation

          return res.status(200).json({ 
              message: 'Login successful',
              token: token,
              user: {
                  admin_id: userResult.rows[0].id,
                  admin_name: userResult.rows[0].name,
                  admin_role: userResult.rows[0].role,
                  email: userResult.rows[0].email
              }
          });
      } else {
          console.log(`Invalid OTP for email: ${email}`);
          return res.status(400).json({ message: 'Invalid OTP' });
      }
  } catch (error) {
      console.error('Admin Login Verification error:', error);
      return res.status(500).json({ message: 'Internal server error' });
  }
});

app.post('/api/validate-token', async (req, res) => {
  const { token } = req.body;

  console.log('Token Validation Request:', token);

  try {
    // Simple token validation 
    // In a real-world scenario, you'd do more robust validation
    const result = await dbPool.query(
      'SELECT id, email, role FROM admin_users WHERE last_token = $1', 
      [token]
    );

    if (result.rows.length > 0) {
      console.log('Token Validation Success');
      return res.status(200).json({ 
        valid: true,
        user: {
          id: result.rows[0].id,
          email: result.rows[0].email,
          role: result.rows[0].role
        }
      });
    } else {
      console.log('Token Validation Failed: No matching user');
      return res.status(401).json({ valid: false, message: 'Invalid token' });
    }
  } catch (error) {
    console.error('Token Validation Error:', error);
    return res.status(500).json({ valid: false, message: 'Internal server error' });
  }
});

// Periodic cleanup of expired OTPs (run every 5 minutes)
setInterval(() => {
  const currentTime = Date.now();
  Object.keys(otps).forEach(email => {
    if (currentTime - otps[email].createdAt > 10 * 60 * 1000) {
      delete otps[email];
    }
  });
}, 5 * 60 * 1000);

app.get('/api/admin/setting/audit-logs', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

  // Select the appropriate pool based on the role if necessary
  const pool = dbPool;

  try {
      const result = await pool.query(`
          SELECT * FROM audit_view
          ORDER BY timestamp DESC;  -- Replace 'created_at' with the appropriate column
      `);
      
      res.json(result.rows);
  } catch (error) {
      console.error('Error fetching audit logs:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/setting/notifications', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters
  const pool = dbPool;

  try {
      const result = await pool.query(`
          SELECT *
          FROM notifications_admin_view
          ORDER BY created_at DESC;
      `);
      
      res.json(result.rows);
  } catch (error) {
      console.error('Error fetching notifications_admin:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/admin/setting/notifications/mark-as-read', async (req, res) => {
  const { ids } = req.body; // Expecting an array of notification IDs
  const { role } = req.query; // Get the role from the query parameters

  // Select the appropriate pool based on the role
  const pool = dbPool;

  if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Invalid request: ids must be a non-empty array' });
  }

  try {
      const query = `
          UPDATE notifications_admin 
          SET read = TRUE 
          WHERE m_id = ANY($1::bigint[])
      `;
      const values = [ids];

      const result = await pool.query(query, values);

      // Optionally, you can return the number of rows updated
      res.status(200).json({ message: 'Notifications marked as read', count: result.rowCount });
  } catch (error) {
      console.error('Error marking notifications as read:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/feedback/feedback-table', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

  // Select the appropriate pool based on the role if necessary
  const pool = dbPool;

  try {
      const result = await pool.query(`
          SELECT * FROM feedback_view
          ORDER BY created_at DESC;
      `);
      
      res.json(result.rows);
  } catch (error) {
      console.error('Error fetching notifications_admin:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/feedback/feedback-stats', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

  // Select the appropriate pool based on the role if necessary
  const pool = dbPool;

  try {
      const result = await pool.query(`
          SELECT * FROM feedback_view
          ORDER BY created_at DESC;
      `);
      
      res.json(result.rows);
  } catch (error) {
      console.error('Error fetching feedback stats:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/feedback/booking-stats', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

  // Select the appropriate pool based on the role if necessary
  const pool = dbPool;

  try {
      const result = await pool.query(`
          SELECT * FROM bookings_view
          ORDER BY created_at DESC;
      `);
      
      res.json(result.rows);
  } catch (error) {
      console.error('Error fetching booking stats:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/feedback/cars-detail', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

  // Select the appropriate pool based on the role if necessary
  const pool = dbPool;

  try {
      const result = await pool.query(`
          SELECT * FROM cars_view
          ORDER BY created_at DESC;
      `);
      
      res.json(result.rows);
  } catch (error) {
      console.error('Error fetching cars detail:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/dashboard/booking-today', async (req, res) => {
  const { role } = req.query;
  const pool = dbPool;
  try {
      const result = await pool.query(`
          SELECT * FROM bookings_view
          WHERE status IN ('Confirmed', 'Finished')
          AND DATE(pickup_date) <= CURRENT_DATE
          AND DATE(return_date) >= CURRENT_DATE
          ORDER BY created_at DESC;
      `);
      
      console.log('Fetched Bookings:', result.rows); // Log the fetched bookings
      res.json(result.rows);
  } catch (error) {
      console.error('Error fetching booking stats:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/dashboard/cars-details', async (req, res) => {
  const { role } = req.query;
  const pool = dbPool;
  try {
    const result = await pool.query(`
        SELECT * FROM cars_view
        ORDER BY id DESC;
    `);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching booking stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/dashboard/earnings-today', async (req, res) => {

  const { role } = req.query;
  const pool = dbPool;try {
      const result = await pool.query(`
          SELECT b.booking_id, c.plate_num, b.price
          FROM bookings_view b
          JOIN cars_view c ON b.car_id = c.id
          WHERE DATE(b.created_at) = CURRENT_DATE
          AND b.priceaccepted = true
          ORDER BY b.created_at DESC;
      `);

      console.log('Fetched Earnings:', result.rows); // Log the fetched earnings
      res.json(result.rows);
  } catch (error) {
      console.error('Error fetching earnings:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/dashboard/task', async (req, res) => {
  const { role } = req.query;
  const pool = dbPool;try {
    const result = await pool.query(`
        SELECT * FROM tasks
        ORDER BY id DESC;
    `);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/admin/dashboard/task/:id', async (req, res) => {
  const taskId = parseInt(req.params.id, 10); // Get the task ID from the request parameters
  const { role } = req.query; // Get the role from the query parameters
  const pool = dbPool;try {
      const result = await pool.query('DELETE FROM tasks WHERE id = $1', [taskId]);
      
      if (result.rowCount === 0) {
          return res.status(404).json({ error: 'Task not found' });
      }

      res.status(204).send(); // Successfully deleted, no content to send
  } catch (error) {
      console.error('Error deleting task:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/admin/dashboard/task', async (req, res) => {
  const { task, date } = req.body; // Destructure the task and date from the request body
  const { role } = req.query; // Get the role from the query parameters

  // Select the appropriate pool based on the role
  const pool = dbPool;

  if (!task || !date) {
      return res.status(400).json({ error: 'Task and date are required' });
  }

  try {
      const result = await pool.query(
          'INSERT INTO tasks (task, date) VALUES ($1, $2) RETURNING *',
          [task, date]
      );

      const newTask = result.rows[0]; // Get the newly added task
      res.status(201).json(newTask); // Respond with the created task
  } catch (error) {
      console.error('Error adding task:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/booking/pie-chart', async (req, res) => {
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

app.get('/api/admin/booking/line-graph', async (req, res) => {
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

app.get('/api/admin/user/pie-chart', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

  // Select the appropriate pool based on the role if necessary
  const pool = dbPool;

  try {
      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days ago

      const result = await pool.query(`
          SELECT 
              CASE 
                  WHEN last_log >= $1 THEN 'Active'
                  ELSE 'Inactive'
              END AS status,
              COUNT(*) AS count 
          FROM users_view 
          GROUP BY status
      `, [sevenDaysAgo]);

      const categoryData = result.rows.map(row => ({
          name: row.status,
          value: parseInt(row.count, 10),
      }));

      res.json(categoryData);
  } catch (error) {
      console.error('Error fetching user status distribution:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/user/line-graph', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

  // Select the appropriate pool based on the role if necessary
  const pool = dbPool;

  try {
      const currentYear = new Date().getFullYear();
      const startDate = new Date(currentYear, 0, 1); // January 1 of the current year
      const endDate = new Date(currentYear, 11, 31); // December 31 of the current year

      // Fetch registered users by date
      const registeredUsersResult = await pool.query(`
          SELECT 
              DATE(created_at) AS date,
              COUNT(*) AS registered_users
          FROM users
          WHERE DATE(created_at) >= $1 AND DATE(created_at) <= $2
          GROUP BY DATE(created_at)
          ORDER BY DATE(created_at)
      `, [startDate, endDate]);

      // Create an array to hold the results
      const userData = registeredUsersResult.rows.map(row => ({
          date: new Date(row.date).toLocaleDateString('en-CA'), // Format date as YYYY-MM-DD in en-CA locale
          registered_users: parseInt(row.registered_users, 10),
      }));

      // Initialize filledData with the starting and ending date
      const filledData = [];
      filledData.push({
          date: startDate.toLocaleDateString('en-CA'), // Format date as YYYY-MM-DD in en-CA locale
          registered_users: 0,
      });

      // Add registered user data
      userData.forEach(entry => filledData.push(entry));

      // Add the ending date if it's not already included
      const endDateStr = endDate.toLocaleDateString('en-CA');
      if (!userData.some(entry => entry.date === endDateStr)) {
          filledData.push({
              date: endDateStr,
              registered_users: 0,
          });
      }

      // Filter to keep only starting, ending, and dates with values
      const finalData = filledData.filter(entry => 
          entry.registered_users > 0 || entry.date === startDate.toLocaleDateString('en-CA') || entry.date === endDateStr
      );

      res.json(finalData);
  } catch (error) {
      console.error('Error fetching registered users line graph data:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/fleet/pie-chart', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

  // Select the appropriate pool based on the role if necessary
  const pool = dbPool;

  try {
      const result = await pool.query(`
          SELECT 
              status,
              COUNT(*) AS count 
          FROM cars_view
          GROUP BY status
      `);

      const categoryData = result.rows.map(row => ({
          name: row.status,
          value: parseInt(row.count, 10),
      }));

      res.json(categoryData);
  } catch (error) {
      console.error('Error fetching fleet status distribution:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/fleet/line-graph', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

  // Select the appropriate pool based on the role if necessary
  const pool = dbPool;

  try {
      const result = await pool.query(`
          SELECT 
              c.brand,
              c.model,
              c.plate_num,  -- Include plate_num here
              DATE(b.created_at) AS created_at,
              SUM((b.return_date - b.pickup_date)) AS rental_days
          FROM bookings_view b
          JOIN cars_view c ON c.id = b.car_id
          GROUP BY c.brand, c.model, c.plate_num, DATE(b.created_at)
          ORDER BY created_at
      `);

      const rentalData = {};
      
      result.rows.forEach(row => {
          const date = row.created_at.toISOString().split('T')[0];
          const car = `${row.brand} ${row.plate_num}`;  // Use brand and plate_num
          const daysRented = parseInt(row.rental_days, 10);

          if (!rentalData[date]) {
              rentalData[date] = {};
          }
          rentalData[date][car] = (rentalData[date][car] || 0) + daysRented;
      });

      const responseData = [];
      for (const [date, cars] of Object.entries(rentalData)) {
          for (const [car, days] of Object.entries(cars)) {
              responseData.push({ date, car, rental_days: days });
          }
      }

      res.json(responseData);
  } catch (error) {
      console.error('Error fetching fleet rental data:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/sales/sales-table', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

  // Select the appropriate pool based on the role if necessary
  const pool = dbPool;

  try {
      const result = await pool.query(`
          SELECT *
          FROM bookings_view
          WHERE status IN ('Confirmed', 'Finished', 'Cancelled')
          ORDER BY booking_id DESC;
      `);

      res.json(result.rows); // Send the retrieved rows as a JSON response
  } catch (error) {
      console.error('Error fetching sales:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/feedback/feedback-piechart', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

  // Select the appropriate pool based on the role if necessary
  const pool = dbPool;

  try {
      const result = await pool.query(`
          SELECT * FROM feedback_view
          ORDER BY created_at DESC;
      `);
      
      res.json(result.rows);
  } catch (error) {
      console.error('Error fetching feedbacks', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});

//=====================================================================

app.get('/api/sales/overview-chart', async (req, res) => {
  try {
    // Get the current date
    const currentDate = new Date();
    const lastSevenDays = new Date();
    lastSevenDays.setDate(currentDate.getDate() - 6); // Get date for 7 days ago

    // Debugging: Log the date range


    // Query to get revenue data for Confirmed and Finished bookings
    const confirmedFinishedRevenueResult = await pool.query(`
      SELECT 
        DATE(created_at) AS date,
        SUM(price) AS total_revenue
      FROM bookings_view
      WHERE status IN ('Confirmed', 'Finished')
        AND created_at >= $1
        AND created_at <= $2
      GROUP BY date
      ORDER BY date
    `, [lastSevenDays, currentDate]);

    // Query to get cancelled fees
    const cancelledRevenueResult = await pool.query(`
      SELECT 
        DATE(cancel_date) AS date,
        SUM(cancel_fee) AS total_cancelled_fee
      FROM bookings_view
      WHERE status = 'Cancelled'
        AND cancel_date >= $1
        AND cancel_date <= $2
      GROUP BY date
      ORDER BY date
    `, [lastSevenDays, currentDate]);

    // Debugging: Log raw query results

    // Combine results into a single array
    const revenueMap = {};

    // Add confirmed and finished revenue
    confirmedFinishedRevenueResult.rows.forEach(row => {
      const dateKey = row.date.toISOString().split('T')[0]; // Format to YYYY-MM-DD
      revenueMap[dateKey] = (revenueMap[dateKey] || 0) + parseFloat(row.total_revenue);
    });

    // Add cancelled fees (as positive revenue)
    cancelledRevenueResult.rows.forEach(row => {
      const dateKey = row.date.toISOString().split('T')[0]; // Format to YYYY-MM-DD
      revenueMap[dateKey] = (revenueMap[dateKey] || 0) + parseFloat(row.total_cancelled_fee);
    });

    // Fill in the last 7 days
    const revenueData = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date();
      date.setDate(currentDate.getDate() - i);
      const formattedDate = date.toISOString().split('T')[0]; // Format to YYYY-MM-DD
      revenueData.push({
        date: formattedDate,
        sales: revenueMap[formattedDate] || 0, // Default to 0 if no data
      });
    }

    // Sort the data in ascending order (oldest to newest)
    revenueData.sort((a, b) => new Date(a.date) - new Date(b.date));

    res.json({ revenueData });
  } catch (error) {
    console.error('Error fetching overview chart data:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

app.get('/api/admin/sales/details/:bookingId', async (req, res) => {
  const bookingId = req.params.bookingId;

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

app.delete('/api/admin/fleet/fleet-table/:id', async (req, res) => {
  const { id } = req.params;
  const { role } = req.query; // Get the role from the query parameters

  // Select the appropriate pool based on the role if necessary
  const pool = dbPool;

  try {
      await pool.query('DELETE FROM cars_view WHERE id = $1', [id]);
      res.status(204).send(); // No content response for successful deletion
  } catch (error) {
      console.error('Error deleting car:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/sales/invoice-data', async (req, res) => {
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

app.get('/api/admin/admins', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

  // Select the appropriate pool based on the role if necessary
  const pool = dbPool;

  try {
      const result = await pool.query('SELECT * FROM admin_users');
      const users = result.rows;
      res.json(users);
  } catch (error) {
      console.error('Error fetching users data:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/admin/admins', async (req, res) => {
  const { name, email, role } = req.body; // Destructure the name, email, and role from the request body
  const { role: userRole } = req.query; // Get the role from the query parameters

  // Select the appropriate pool based on the role
  const pool = dbPool;

  // Validate input data
  if (!name || !email || !role) {
      return res.status(400).json({ error: 'Name, email, and role are required' });
  }

  try {
      const result = await pool.query(
          'INSERT INTO admin_users (name, email, role) VALUES ($1, $2, $3) RETURNING *',
          [name, email, role]
      );

      const newAdmin = result.rows[0]; // Get the newly added admin
      res.status(201).json(newAdmin); // Respond with the created admin
  } catch (error) {
      console.error('Error adding admin:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});


app.delete('/api/admin/admins/:id', async (req, res) => {
  const id = req.params.id;
  try {
    const result = await dbPool.query('DELETE FROM admin_users WHERE id = $1', [id]);
    
    if (result.rowCount === 0) {
        return res.status(404).json({ error: 'User not found' });
    }

    res.status(204).send(); // Successfully deleted, no content to send
} catch (error) {
    console.error('Error deleting task:', error);
    res.status(500).json({ error: 'Internal server error' });
}
});
