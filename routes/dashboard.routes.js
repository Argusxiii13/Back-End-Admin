const express = require('express');

module.exports = (deps) => {
  const router = express.Router();
  const { pool, dbPool, io, upload, sendEmailHandler, sendEmailNotif, sendEmailInvoice, generateInvoicePDF, notifyClient, notifyAdmin, emitAdminNotification, logAction, retryPgOperation, validatePassword, bcrypt, crypto, otps, nodemailer, axios } = deps;

router.get('/api/admin/dashboard/new-bookings', async (req, res) => {
  const { role } = req.query;
  const pool = dbPool;

  try {
      const result = await pool.query(`
          SELECT COUNT(*) AS total 
          FROM bookings
      WHERE (created_at AT TIME ZONE 'Asia/Manila')::date = (NOW() AT TIME ZONE 'Asia/Manila')::date
    `);

      const newBookings = result.rows[0].total;
      res.json({ total: newBookings });
  } catch (error) {
      console.error('Error fetching new bookings:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});


router.get('/api/admin/dashboard/new-users', async (req, res) => {
  try {
    const { role } = req.query;

  const pool = dbPool;

    const result = await pool.query(`
      SELECT COUNT(*) AS total 
      FROM users 
      WHERE (created_at AT TIME ZONE 'Asia/Manila')::date = (NOW() AT TIME ZONE 'Asia/Manila')::date
    `);

    const newUsers = result.rows[0].total;
    res.json({ total: newUsers });
  } catch (error) {
    console.error('Error fetching new users:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


router.get('/api/admin/dashboard/new-feedback-count', async (req, res) => {
  try {
    const { role } = req.query;

  const pool = dbPool;

    const result = await pool.query(`
      SELECT COUNT(*) AS total 
      FROM feedback 
      WHERE (created_at AT TIME ZONE 'Asia/Manila')::date = (NOW() AT TIME ZONE 'Asia/Manila')::date
    `);

    const newFeedbackCount = result.rows[0].total;
    
    res.json({ total: newFeedbackCount });
  } catch (error) {
    console.error('Error fetching new feedback count:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


router.get('/api/admin/dashboard/today-revenue', async (req, res) => {
  try {
    const { role } = req.query;

  const pool = dbPool;

    const result = await pool.query(`
      SELECT SUM(price) AS total_revenue 
      FROM bookings 
      WHERE (created_at AT TIME ZONE 'Asia/Manila')::date = (NOW() AT TIME ZONE 'Asia/Manila')::date
      AND status IN ('Finished', 'Confirmed')
    `);

    const todayRevenueRaw = result.rows[0]?.total_revenue;
    const todayRevenue = Number.parseFloat(todayRevenueRaw ?? '0');
    const safeRevenue = Number.isFinite(todayRevenue) ? todayRevenue : 0;
    res.json({ total: safeRevenue.toFixed(2) });
  } catch (error) {
    console.error('Error fetching today\'s revenue:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


router.get('/api/admin/dashboard/category-distribution', async (req, res) => {

  const { role } = req.query;
  const pool = dbPool;try {
      const result = await pool.query(`
          SELECT status, COUNT(*) AS count 
          FROM bookings 
      WHERE (created_at AT TIME ZONE 'Asia/Manila')::date = (NOW() AT TIME ZONE 'Asia/Manila')::date
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


router.get('/api/admin/dashboard/booking-today', async (req, res) => {
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

      res.json(result.rows);
  } catch (error) {
      console.error('Error fetching booking stats:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});


router.get('/api/admin/dashboard/cars-details', async (req, res) => {
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


router.get('/api/admin/dashboard/earnings-today', async (req, res) => {

  const { role } = req.query;
  const pool = dbPool;try {
      const result = await pool.query(`
          SELECT b.booking_id, c.plate_num, b.price
          FROM bookings_view b
          JOIN cars_view c ON b.car_id = c.id
      WHERE (b.created_at AT TIME ZONE 'Asia/Manila')::date = (NOW() AT TIME ZONE 'Asia/Manila')::date
          AND b.priceaccepted = true
          ORDER BY b.created_at DESC;
      `);

      res.json(result.rows);
  } catch (error) {
      console.error('Error fetching earnings:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});


router.get('/api/admin/dashboard/task', async (req, res) => {
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


router.delete('/api/admin/dashboard/task/:id', async (req, res) => {
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


router.post('/api/admin/dashboard/task', async (req, res) => {
  const { task, date } = req.body; // Destructure the task and date from the request body
  const { role } = req.query; // Get the role from the query parameters

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

  return router;
};
