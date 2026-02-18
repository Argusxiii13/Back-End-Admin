const express = require('express');

module.exports = (deps) => {
  const router = express.Router();
  const { pool, dbPool, io, upload, sendEmailHandler, sendEmailNotif, sendEmailInvoice, generateInvoicePDF, notifyClient, notifyAdmin, emitAdminNotification, logAction, retryPgOperation, validatePassword, bcrypt, crypto, otps, nodemailer, axios } = deps;

router.get('/api/admin/analytics/bookings-data', async (req, res) => {
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


router.get('/api/admin/analytics/users-data', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

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


router.get('/api/admin/analytics/cars-data', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

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


router.get('/api/admin/analytics/feedback-data', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

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

  return router;
};
