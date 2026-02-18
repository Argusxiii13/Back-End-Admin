const express = require('express');

module.exports = (deps) => {
  const router = express.Router();
  const { pool, dbPool, io, upload, sendEmailHandler, sendEmailNotif, sendEmailInvoice, generateInvoicePDF, notifyClient, notifyAdmin, emitAdminNotification, logAction, retryPgOperation, validatePassword, bcrypt, crypto, otps, nodemailer, axios } = deps;

router.get('/api/admin/feedback/feedback-table', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

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


router.get('/api/admin/feedback/feedback-stats', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

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


router.get('/api/admin/feedback/booking-stats', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

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


router.get('/api/admin/feedback/cars-detail', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

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


router.get('/api/admin/feedback/feedback-piechart', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

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


  return router;
};
