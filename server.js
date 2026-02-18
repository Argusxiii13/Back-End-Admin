const express = require("express");
const { Pool } = require('pg');
const cors = require("cors");
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');
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
const app = express();
const PORT = 5174;
const crypto = require('crypto'); // To generate random OTP
const otps = {};


app.use(express.static(path.join(__dirname, 'admin')));


const dbPool = new Pool({ connectionString: process.env.DATABASE_URL });

const httpServer = http.createServer(app);
const socketCorsOrigin = allowedOrigin && allowedOrigin !== '*' ? allowedOrigin : '*';
const io = new Server(httpServer, {
  cors: {
    origin: socketCorsOrigin,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
  }
});

io.on('connection', (socket) => {
  socket.on('join-admin-room', (adminId) => {
    if (!adminId) return;
    socket.join(`admin:${adminId}`);
  });
});


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

const validatePassword = (password) => {
  const regex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d]{8,}$/;
  return regex.test(password);
};

dbPool.connect((err) => {
  if (err) {
    console.error('Error connecting to the database:', err);
    return;
  }
  console.log('Connected to the database. This is Admin Side');
});

process.on('SIGINT', () => {
  dbPool.end(() => {
    console.log('PostgreSQL connection pool closed.');
    process.exit(0);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  
});

const logAction = async (admin_id, admin_name, admin_role, action, details) => {
  const pool = dbPool;
  const client = await pool.connect();
  
  const sanitizeValue = (value) => {
    if (value == null) return null;
    if (Buffer.isBuffer(value)) return null;
    
    if (typeof value === 'object') {
      if (Array.isArray(value)) {
        return value.map(sanitizeValue).filter(v => v !== null);
      }
      
      const sanitized = {};
      for (const [key, val] of Object.entries(value)) {
        const cleanVal = sanitizeValue(val);
        if (cleanVal !== null) {
          sanitized[key] = cleanVal;
        }
      }
      return Object.keys(sanitized).length > 0 ? sanitized : null;
    }
    
    if (typeof value === 'string') {
      if (value.startsWith('{') || value.startsWith('[')) {
        try {
          JSON.parse(value);
          return null; // It's a JSON string, filter it out
        } catch {
          return value;
        }
      }
      return value;
    }
    
    return value;
  };

  try {
    const processedDetails = typeof details === 'object' 
      ? sanitizeValue(details)
      : { value: sanitizeValue(details) };

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

const notifyClient = async (booking_id, user_id, title, message, admin_role) => {
  const pool = dbPool;
  const client = await pool.connect();

  try {
      await client.query(
          'INSERT INTO notifications_client (booking_id, user_id, title, message) VALUES ($1, $2, $3, $4)',
          [booking_id, user_id, title, message]
      );
      
      io.to(`user:${user_id}`).emit('admin:data-updated', {
        type: 'notification_created',
        user_id,
        booking_id,
        notification: { title, message, created_at: new Date() }
      });
  } catch (error) {
      console.error('Error Sending Notif', error);
  } finally {
      client.release();
  }
};

const emitAdminNotification = (adminId, notification) => {
  io.to(`admin:${adminId}`).emit('admin:notification-update', {
    type: 'notification_created',
    admin_id: adminId,
    notification
  });
};


const mountDomainRoutes = require('./routes');

mountDomainRoutes(app, {
  dbPool,
  io,
  upload,
  sendEmailHandler,
  sendEmailNotif,
  sendEmailInvoice,
  generateInvoicePDF,
  notifyClient,
  emitAdminNotification,
  logAction,
  validatePassword,
  crypto,
  otps,
  nodemailer,
  axios
});
