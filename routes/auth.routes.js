const express = require('express');

module.exports = (deps) => {
  const router = express.Router();
  const { pool, dbPool, io, upload, sendEmailHandler, sendEmailNotif, sendEmailInvoice, generateInvoicePDF, notifyClient, notifyAdmin, emitAdminNotification, logAction, retryPgOperation, validatePassword, bcrypt, crypto, otps, nodemailer, axios } = deps;

router.post('/api/admin/login-otp', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: 'Email is required' });
  }

  try {
    const result = await dbPool.query('SELECT * FROM admin_users WHERE email = $1', [email]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Email not found in admin users' });
    }

    const otp = crypto.randomInt(100000, 999999).toString(); // 6-digit OTP
    otps[email] = {
      otp: otp,
      createdAt: Date.now()
    }; 

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

    const mailOptions = {
      from: process.env.SMTP_USER,
      to: email,
      subject: 'Admin Login OTP',
      text: `Your Admin Login OTP is: ${otp}. This OTP will expire in 10 minutes.`,
    };

    await transporter.sendMail(mailOptions);
    return res.status(200).json({ message: 'OTP sent successfully' });
  } catch (error) {
    console.error('Admin Login OTP error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});


router.post('/api/admin/verify-login-otp', async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
      return res.status(400).json({ message: 'Email and OTP are required' });
  }

  try {
      const storedOtpData = otps[email]; // Retrieve stored OTP data here

      if (!storedOtpData) {
          return res.status(400).json({ message: 'No OTP found. Please request a new OTP.' });
      }

      const currentTime = Date.now();
      if (currentTime - storedOtpData.createdAt > 10 * 60 * 1000) {
          delete otps[email];
          return res.status(400).json({ message: 'OTP has expired. Please request a new one.' });
      }

      if (storedOtpData.otp === otp) {
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
          return res.status(400).json({ message: 'Invalid OTP' });
      }
  } catch (error) {
      console.error('Admin Login Verification error:', error);
      return res.status(500).json({ message: 'Internal server error' });
  }
});


router.post('/api/validate-token', async (req, res) => {
  const { token } = req.body;

  try {
    const result = await dbPool.query(
      'SELECT id, email, role FROM admin_users WHERE last_token = $1', 
      [token]
    );

    if (result.rows.length > 0) {
      return res.status(200).json({ 
        valid: true,
        user: {
          id: result.rows[0].id,
          email: result.rows[0].email,
          role: result.rows[0].role
        }
      });
    } else {
      return res.status(401).json({ valid: false, message: 'Invalid token' });
    }
  } catch (error) {
    console.error('Token Validation Error:', error);
    return res.status(500).json({ valid: false, message: 'Internal server error' });
  }
});


setInterval(() => {
  const currentTime = Date.now();
  Object.keys(otps).forEach(email => {
    if (currentTime - otps[email].createdAt > 10 * 60 * 1000) {
      delete otps[email];
    }
  });
}, 5 * 60 * 1000);

  return router;
};
