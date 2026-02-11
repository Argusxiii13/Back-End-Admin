const ejs = require('ejs');
const path = require('path');
const htmlPdf = require('html-pdf-node');
const puppeteer = require('puppeteer');

async function generateInvoicePDF(invoiceData) {
    try {
        const templatePath = path.join(__dirname, '../views/invoice.ejs');
        const html = await ejs.renderFile(templatePath, invoiceData);

        const options = { format: 'A4' };
        const file = { content: html };

        return new Promise((resolve, reject) => {
            htmlPdf.generatePdf(file, options).then((pdfBuffer) => {
                resolve(pdfBuffer);
            }).catch((error) => {
                reject(error);
            });
        });
    } catch (error) {
        console.error('Error generating PDF:', error);
        throw error;
    }
}

module.exports = { generateInvoicePDF };

