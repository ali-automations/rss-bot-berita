const express = require('express');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const Parser = require('rss-parser');
const { Groq } = require('groq-sdk');
const { google } = require('googleapis');

const app = express();

const parser = new Parser();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function runAutomation() {
    console.log("Memulai eksekusi alur kerja: RSS -> Groq -> Google Sheets...");
    
    // Autentikasi Google Sheets (VERSI CLOUD AMAN TANPA FILE JSON)
    const auth = new google.auth.GoogleAuth({
        credentials: {
            client_email: process.env.GOOGLE_CLIENT_EMAIL,
            private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
        },
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const sheets = google.sheets({ version: 'v4', auth });

    // Tarik Data RSS
    console.log(`Mengambil RSS dari: ${process.env.TARGET_RSS_URL}`);
    const feed = await parser.parseURL(process.env.TARGET_RSS_URL);
    const targetArticles = feed.items.slice(0, 3); 

    for (const item of targetArticles) {
        console.log(`\nMemproses Artikel: ${item.title}`);
        const rawText = item.contentSnippet || item.content || item.title;

        const promptContext = `Bertindaklah sebagai ekstraktor data. Baca teks berikut dan kembalikan HANYA format JSON murni tanpa teks pengantar atau penutup. Skema JSON wajib: {"ringkasan": "string maksimal 2 kalimat", "kata_kunci": ["array of strings", "maksimal 5 kata"]}. Teks: ${rawText}`;

        const chatCompletion = await groq.chat.completions.create({
            messages: [{ role: 'user', content: promptContext }],
            model: 'llama-3.1-8b-instant',
            temperature: 0.1,
            response_format: { type: 'json_object' } 
        });

        const llmOutput = JSON.parse(chatCompletion.choices[0].message.content);
        const keywordString = llmOutput.kata_kunci.join(', ');

        await sheets.spreadsheets.values.append({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: 'Sheet1!A:E', 
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [[
                    item.title, 
                    item.link, 
                    llmOutput.ringkasan, 
                    keywordString, 
                    new Date().toISOString()
                ]]
            }
        });
        console.log(`✅ Berhasil menyimpan ke Sheets.`);
    }
    console.log("\nAlur kerja selesai dieksekusi.");
}

// URL PEMICU (WEBHOOK)
app.get('/eksekusi', async (req, res) => {
    try {
        console.log("Menerima sinyal, menjalankan otomatisasi...");
        await runAutomation();
        res.status(200).send("✅ Berhasil! Berita sudah diekstrak dan masuk ke Google Sheets.");
    } catch (error) {
        console.error("❌ Terjadi Kesalahan:", error.message);
        res.status(500).send("❌ Gagal menjalankan otomatisasi: " + error.message);
    }
});

// EXPORT UNTUK VERCEL (Menggantikan app.listen)
module.exports = app;