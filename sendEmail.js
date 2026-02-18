const nodemailer = require("nodemailer");
const dotenv = require('dotenv');
dotenv.config();

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = process.env.SMTP_PORT;
const SMTP_SECURE = process.env.SMTP_SECURE === 'true'; // Convert to boolean
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;

async function verifyCaptcha(solution) {
    try {
        const response = await fetch('https://api.friendlycaptcha.com/api/v1/siteverify', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                solution: solution,
                secret: process.env.FRIENDLY_CAPTCHA_SECRET,
                sitekey: 'FCMGR12NTIE60LB9',
            }),
        });

        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error verifying captcha:', error);
        return { success: false, errors: ['Failed to verify captcha'] };
    }
}

const sendEmailHandler = async (req, res) => {

    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    }

    const { name, email, phone, inquiry, captchaSolution } = req.body;

    if (!captchaSolution) {
        return res.status(400).json({ message: 'Captcha solution is required' });
    }

    try {
        const captchaVerification = await verifyCaptcha(captchaSolution);

        if (!captchaVerification.success) {
            console.error('Captcha verification failed:', captchaVerification.errors);
            return res.status(400).json({ message: 'Captcha verification failed', details: captchaVerification.errors });
        }

        const transporter = nodemailer.createTransport({
            host: SMTP_HOST,
            port: SMTP_PORT,
            secure: SMTP_SECURE,
            auth: {
                user: SMTP_USER,
                pass: SMTP_PASS,
            },
        });

        const inquiryMailOptions = {
            from: SMTP_USER,
            to: SMTP_USER, // Send to the same address as SMTP_USER
            subject: `New Inquiry from ${name}`,
            text: `You have a new inquiry from ${name} (${email}, ${phone}): ${inquiry}`,
        };

        await transporter.sendMail(inquiryMailOptions);

        const confirmationMailOptions = {
            from: SMTP_USER,
            to: email, // The user's email address
            subject: 'Inquiry Received',
            text: 'Your inquiry has been received by Autoconnect. Please wait for further reply.',
        };

        await transporter.sendMail(confirmationMailOptions);

        res.status(200).json({ message: 'Inquiry sent and confirmation email sent successfully' });
    } catch (error) {
        console.error('Error in send-email:', error);
        return res.status(500).json({ message: 'Failed to send email', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
};

module.exports = sendEmailHandler;