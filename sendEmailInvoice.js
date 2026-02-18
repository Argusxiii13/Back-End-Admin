const nodemailer = require("nodemailer");
const dotenv = require('dotenv');
const { generateInvoicePDF } = require('./lib/generatePDF.js');
dotenv.config();

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
                <p>This is an automated message from AutoConnect Transport. You may reply to this email if you have any questions or concerns.</p>
            </div>
        </div>
    </body>
    </html>
    `;
}

async function sendEmailInvoice(invoiceData, clientEmail) {
    try {
        const pdfBuffer = await generateInvoicePDF(invoiceData);

        const transporter = nodemailer.createTransport({
            host: SMTP_HOST,
            port: SMTP_PORT,
            secure: SMTP_SECURE,
            auth: {
                user: SMTP_USER,
                pass: SMTP_PASS,
            },
        });

        const messageContent = `
        Hello,\n\n
        Great news! Your booking (ID: ${invoiceData.invoiceNo}) has been successfully confirmed. We’re thrilled to have the opportunity to serve you and ensure your journey goes smoothly.\n\n
        If you have any questions or need assistance, feel free to contact us at any time.\n\n
        Thank you for choosing AutoConnect Transport. We look forward to serving you!\n\n
        Best regards,\n
        The AutoConnect Transport Team
        `;

        const mailOptions = {
            from: SMTP_USER,
            to: clientEmail,
            subject: `Invoice #${invoiceData.invoiceNo}`,
            html: generateEmailHTML({
                subject: `Invoice #${invoiceData.invoiceNo}`,
                content: messageContent,
            }),
            attachments: [
                {
                    filename: `Invoice_${invoiceData.invoiceNo}.pdf`,
                    content: pdfBuffer,
                    contentType: 'application/pdf',
                },
            ],
        };

        await transporter.sendMail(mailOptions);
    } catch (error) {
        console.error('Error Sending Invoice Email', error);
    }
}

module.exports = sendEmailInvoice;