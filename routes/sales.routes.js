const express = require('express');

module.exports = (deps) => {
  const router = express.Router();
  const { pool, dbPool, io, upload, sendEmailHandler, sendEmailNotif, sendEmailInvoice, generateInvoicePDF, notifyClient, notifyAdmin, emitAdminNotification, logAction, retryPgOperation, validatePassword, bcrypt, crypto, otps, nodemailer, axios } = deps;

router.get("/api/generate-invoice", async (req, res) => {
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

      res.set({
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'attachment; filename="invoice.pdf"',
          'Content-Length': pdfBuffer.length
      });

      res.send(pdfBuffer);
  } catch (error) {
      console.error('Error generating PDF:', error);
      res.status(500).json({ message: "Error generating PDF", error: error.message });
  }
});


function calculateRentalDays(pickupDate, returnDate) {
  const start = new Date(pickupDate);
  const end = new Date(returnDate);
  const timeDiff = end - start;
  return Math.ceil(timeDiff / (1000 * 60 * 60 * 24)); // Convert milliseconds to days
}


router.post("/api/generate-invoice", async (req, res) => {
  const { bookingId, officer, createdAt, pickupDate, returnDate, rentalType, name, price, role, carId, driver } = req.body;

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
      const pdfBuffer = await generateInvoicePDF(invoiceData);

      res.set({
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="invoice_${bookingId}.pdf"`,
          'Content-Length': pdfBuffer.length,
      });

      res.send(pdfBuffer);
  } catch (error) {
      console.error('Error generating PDF:', error);
      res.status(500).json({ message: "Error generating PDF", error: error.message });
  }
});


router.get('/api/admin/sales/car-details', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

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


router.get('/api/admin/sales/sales-statistics', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

  const pool = dbPool;

  try {
      const totalRevenueResult = await pool.query(`
        SELECT 
          SUM(CASE WHEN status IN ('Confirmed', 'Finished') THEN price ELSE 0 END) +
          SUM(CASE WHEN status = 'Cancelled' THEN cancel_fee ELSE 0 END) AS total_revenue 
        FROM bookings_view
      `);

      const totalRevenue = parseFloat(totalRevenueResult.rows[0].total_revenue) || 0;

      const totalExpensesResult = await pool.query(`
        SELECT SUM(expenses) AS total_expenses 
        FROM bookings_view 
        WHERE status = 'Finished'
      `);

      const totalExpenses = parseFloat(totalExpensesResult.rows[0].total_expenses) || 0;
      const netIncome = totalRevenue - totalExpenses;

      const cancelledEarningsResult = await pool.query(`
        SELECT SUM(cancel_fee) AS cancelled_earning 
        FROM bookings_view 
        WHERE status = 'Cancelled'
      `);

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


router.get('/api/admin/sales/all-data', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

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


router.get('/api/admin/sales/sales-table', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

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


router.get('/api/sales/overview-chart', async (req, res) => {
  try {
    const currentDate = new Date();
    const lastSevenDays = new Date();
    lastSevenDays.setDate(currentDate.getDate() - 6); // Get date for 7 days ago


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


    const revenueMap = {};

    confirmedFinishedRevenueResult.rows.forEach(row => {
      const dateKey = row.date.toISOString().split('T')[0]; // Format to YYYY-MM-DD
      revenueMap[dateKey] = (revenueMap[dateKey] || 0) + parseFloat(row.total_revenue);
    });

    cancelledRevenueResult.rows.forEach(row => {
      const dateKey = row.date.toISOString().split('T')[0]; // Format to YYYY-MM-DD
      revenueMap[dateKey] = (revenueMap[dateKey] || 0) + parseFloat(row.total_cancelled_fee);
    });

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

    revenueData.sort((a, b) => new Date(a.date) - new Date(b.date));

    res.json({ revenueData });
  } catch (error) {
    console.error('Error fetching overview chart data:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});


router.get('/api/admin/sales/details/:bookingId', async (req, res) => {
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


router.get('/api/admin/sales/invoice-data', async (req, res) => {
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

  return router;
};
