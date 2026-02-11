const nodemailer = require("nodemailer");
const dotenv = require('dotenv');

dotenv.config();

// SMTP configuration
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = process.env.SMTP_PORT;
const SMTP_SECURE = process.env.SMTP_SECURE === 'true';
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;

function generateEmailHTML(options) {

  const { subject, content } = options;

  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${subject}</title>
      <style>
          body {
              font-family: Arial, sans-serif;
              line-height: 1.6;
              color: #333;
              margin: 0;
              padding: 0;
              background-color: #f5f5f5;
          }
          .container {
              max-width: 600px;
              margin: 20px auto;
              background: #ffffff;
              border-radius: 8px;
              box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
          }
          .header {
              background-color: #f8f9fa;
              padding: 20px;
              border-radius: 8px 8px 0 0;
              border-bottom: 1px solid #eee;
          }
          .content {
              padding: 30px 20px;
              background: #ffffff;
          }
          .sender {
              display: flex;
              align-items: center;
              margin-bottom: 25px;
              padding-bottom: 20px;
              border-bottom: 1px solid #eee;
          }
          .sender-initial {
              width: 40px;
              height: 40px;
              background-color: #0066cc;
              color: white;
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              margin-right: 15px;
              font-weight: bold;
              font-size: 16px;
          }
          .sender-info {
              font-size: 14px;
              color: #666;
          }
          .sender-email {
              color: #0066cc;
              text-decoration: none;
              font-weight: 500;
              margin-bottom: 4px;
          }
          .message-content {
              white-space: pre-line;
              padding: 0 10px;
              color: #444;
          }
          .footer {
              background-color: #f8f9fa;
              padding: 15px 20px;
              border-radius: 0 0 8px 8px;
              border-top: 1px solid #eee;
          }
          .footer p {
              margin: 0;
              font-size: 12px;
              color: #666;
              text-align: center;
          }
          @media only screen and (max-width: 600px) {
              .container {
                  margin: 10px;
                  width: auto;
              }
              .content {
                  padding: 20px 15px;
              }
          }
      </style>
  </head>
  <body>
      <div class="container">
          <div class="header">
              <h2 style="margin: 0; color: #333; font-size: 20px;">${subject}</h2>
          </div>
          <div class="content">
              <div class="message-content">${content}</div>
          </div>
          <div class="footer">
              <p>This is an automated message from AutoConnect Transport. You may reply to this email if you have any questions or concern.</p>
          </div>
      </div>
  </body>
  </html>
  `;
}

// Middleware to send email notifications
const sendEmailNotif = async (title, message, clientEmail) => {
    try {
        // Set up Nodemailer transporter
        const transporter = nodemailer.createTransport({
            host: SMTP_HOST,
            port: SMTP_PORT,
            secure: SMTP_SECURE,
            auth: {
                user: SMTP_USER,
                pass: SMTP_PASS,
            },
        });

        // Email options for the client notification
        const mailOptions = {
            from: SMTP_USER,
            to: clientEmail, // The client's email address
            subject: title,
            html: generateEmailHTML({
                subject: title,
                content: `<p>${message}</p>`,
                senderInitial: SMTP_USER.charAt(0).toUpperCase(), // Initial of the sender
                senderEmail: SMTP_USER,
            }),
        };

        // Send the email notification
        console.log(`succesfully sent email`);
        await transporter.sendMail(mailOptions);
        console.log('Email sent to client successfully');
    } catch (error) {
        console.error('Error Sending Email Notification', error);
    }
};

module.exports = sendEmailNotif;