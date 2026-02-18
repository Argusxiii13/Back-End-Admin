const express = require('express');

module.exports = (deps) => {
  const router = express.Router();
  const { pool, dbPool, io, upload, sendEmailHandler, sendEmailNotif, sendEmailInvoice, generateInvoicePDF, notifyClient, notifyAdmin, emitAdminNotification, logAction, retryPgOperation, validatePassword, bcrypt, crypto, otps, nodemailer, axios } = deps;

router.get('/api/admin/admins', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters
  const demoEmail = (process.env.DEMO_ADMIN_EMAIL || 'autoconnectdemo13@gmail.com').toLowerCase();

  const pool = dbPool;

  try {
      const result = await pool.query(
        `SELECT *
         FROM admin_users
         ORDER BY
           CASE WHEN LOWER(email) = $1 THEN 0 ELSE 1 END,
           created_at ASC,
           id ASC`,
        [demoEmail]
      );
      const users = result.rows;
      res.json(users);
  } catch (error) {
      console.error('Error fetching users data:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});


router.post('/api/admin/admins', async (req, res) => {
  const { name, email, role } = req.body; // Destructure the name, email, and role from the request body
  const { role: userRole } = req.query; // Get the role from the query parameters

  const pool = dbPool;

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


router.delete('/api/admin/admins/:id', async (req, res) => {
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

  return router;
};
