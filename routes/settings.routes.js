const express = require('express');

module.exports = (deps) => {
  const router = express.Router();
  const { pool, dbPool, io, upload, sendEmailHandler, sendEmailNotif, sendEmailInvoice, generateInvoicePDF, notifyClient, notifyAdmin, emitAdminNotification, logAction, retryPgOperation, validatePassword, bcrypt, crypto, otps, nodemailer, axios } = deps;

const getAuditLogs = async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

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
};

router.get('/api/admin/settings/audit-logs', getAuditLogs);
router.get('/api/admin/setting/audit-logs', getAuditLogs);

const getNotifications = async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters
  const pool = dbPool;

  try {
    const result = await pool.query(`
      SELECT *
      FROM notifications_admin_view
      ORDER BY created_at DESC;
    `);

    return res.json(result.rows);
  } catch (error) {
    const isMissingView = error && error.code === '42P01';

    if (!isMissingView) {
      console.error('Error fetching notifications_admin:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }

    try {
      const fallbackResult = await pool.query(`
        SELECT *
        FROM notifications_admin
        ORDER BY created_at DESC;
      `);

      return res.json(fallbackResult.rows);
    } catch (fallbackError) {
      console.error('Error fetching notifications_admin fallback:', fallbackError);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
};

router.get('/api/admin/settings/notifications', getNotifications);
router.get('/api/admin/setting/notifications', getNotifications);


const markNotificationsRead = async (req, res) => {
  const { ids } = req.body; // Expecting an array of notification IDs
  const { role } = req.query; // Get the role from the query parameters

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

      res.status(200).json({ message: 'Notifications marked as read', count: result.rowCount });
  } catch (error) {
      console.error('Error marking notifications as read:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
};

router.post('/api/admin/settings/notifications/mark-as-read', markNotificationsRead);
router.post('/api/admin/setting/notifications/mark-as-read', markNotificationsRead);

  return router;
};
