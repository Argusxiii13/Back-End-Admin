const express = require('express');

module.exports = (deps) => {
  const router = express.Router();
  const { pool, dbPool, io, upload, sendEmailHandler, sendEmailNotif, sendEmailInvoice, generateInvoicePDF, notifyClient, notifyAdmin, emitAdminNotification, logAction, retryPgOperation, validatePassword, bcrypt, crypto, otps, nodemailer, axios } = deps;

router.get('/api/admin/users/users-table', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

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


router.get('/api/admin/users/image/:user_id', async (req, res) => {
  const user_id = req.params.user_id;
  const { role } = req.query; // Get the role from the query parameters

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

      const contentType = 'image/jpeg'; // Default content type, adjust as needed
      res.set('Content-Type', contentType);

      res.send(profilePictureBuffer);
  } catch (error) {
      console.error('Error retrieving profile picture:', error);
      return res.status(500).json({ error: 'Internal server error' });
  }
});


router.get('/api/admin/users/statistics', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

  const pool = dbPool;

  try {
      const totalUsersResult = await pool.query(`
          SELECT COUNT(*) AS total_users 
          FROM users
      `);

      const newUsersTodayResult = await pool.query(`
          SELECT COUNT(*) AS new_users_today 
          FROM users 
          WHERE created_at::date = CURRENT_DATE
      `);

      const activeUsersResult = await pool.query(`
          SELECT COUNT(*) AS active_users
          FROM users
          WHERE last_log >= NOW() - INTERVAL '7 days'
      `);

      const inactiveUsersResult = await pool.query(`
          SELECT COUNT(*) AS inactive_users
          FROM users
          WHERE last_log < NOW() - INTERVAL '7 days'
      `);

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


const getUserPieChart = async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

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
};

router.get('/api/admin/users/pie-chart', getUserPieChart);
router.get('/api/admin/user/pie-chart', getUserPieChart);


const getUserLineGraph = async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

  const pool = dbPool;

  try {
      const currentYear = new Date().getFullYear();
      const startDate = new Date(currentYear, 0, 1); // January 1 of the current year
      const endDate = new Date(currentYear, 11, 31); // December 31 of the current year

      const registeredUsersResult = await pool.query(`
          SELECT 
              DATE(created_at) AS date,
              COUNT(*) AS registered_users
          FROM users
          WHERE DATE(created_at) >= $1 AND DATE(created_at) <= $2
          GROUP BY DATE(created_at)
          ORDER BY DATE(created_at)
      `, [startDate, endDate]);

      const userData = registeredUsersResult.rows.map(row => ({
          date: new Date(row.date).toLocaleDateString('en-CA'), // Format date as YYYY-MM-DD in en-CA locale
          registered_users: parseInt(row.registered_users, 10),
      }));

      const filledData = [];
      filledData.push({
          date: startDate.toLocaleDateString('en-CA'), // Format date as YYYY-MM-DD in en-CA locale
          registered_users: 0,
      });

      userData.forEach(entry => filledData.push(entry));

      const endDateStr = endDate.toLocaleDateString('en-CA');
      if (!userData.some(entry => entry.date === endDateStr)) {
          filledData.push({
              date: endDateStr,
              registered_users: 0,
          });
      }

      const finalData = filledData.filter(entry => 
          entry.registered_users > 0 || entry.date === startDate.toLocaleDateString('en-CA') || entry.date === endDateStr
      );

      res.json(finalData);
  } catch (error) {
      console.error('Error fetching registered users line graph data:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
};

router.get('/api/admin/users/line-graph', getUserLineGraph);
router.get('/api/admin/user/line-graph', getUserLineGraph);

  return router;
};
