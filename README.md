# Agape Kiddie City Academy ERP

A lightweight, local-first school ERP web application for Agape Kiddie City Academy, built with Node.js, Express, and SQLite. No cloud database required — everything runs on your computer using a local `erp.db` file.

## Features

- **Dashboard Summary**: Total pupils by section (Crèche, Kindergarten, Primary), fees billed, fees collected, and outstanding balances.
- **Pupils Directory**: Add, view, search, and filter pupils by section and class (Crèche, Kindergarten 1–2, Primary 1–6).
- **Fees & Billing**: Create individual invoices or general invoices for a whole section/class, record partial/full payments (in GHS), auto-calculate balance due, and group invoices by section and class.
- **Daily Attendance**: Mark every pupil Present, Absent, or Late for any date, with a one-click "Mark All Present" option.

## Folder Structure

```
Simple ERP/
├── server.js          # Express server entry point
├── db.js              # SQLite database setup + seed data
├── package.json       # Node.js dependencies & scripts
├── README.md          # This file
├── erp.db             # Local SQLite database (created on first run)
├── routes/
│   ├── dashboard.js   # Dashboard summary API
│   ├── pupils.js      # Pupils CRUD API
│   ├── fees.js        # Fee invoices & payments API
│   └── attendance.js  # Daily attendance API
└── public/
    ├── index.html     # Main frontend page
    ├── styles.css     # Styling
    └── app.js         # Frontend JavaScript
```

## Prerequisites

- [Node.js](https://nodejs.org/) installed (version 14 or higher recommended)

## Step-by-Step: Run on Windows Command Prompt

1. Open **Command Prompt** (`cmd`).

2. Navigate to the project folder:
   ```
   cd C:\Users\Deedew\Desktop\Simple ERP
   ```

3. Install dependencies:
   ```
   npm install
   ```

4. Start the server:
   ```
   npm start
   ```
   or:
   ```
   node server.js
   ```

5. You should see:
   ```
   Agape Kiddie City Academy ERP running at http://localhost:3000
   ```

6. Open your browser and go to:
   ```
   http://localhost:3000
   ```

## Sample Data

On first run, the app automatically seeds the database with:
- 10 sample pupils across Crèche, Kindergarten, and Primary sections
- 10 fee invoices (Term 1, 2024-2025) with a mix of Paid, Partial, and Unpaid statuses

You can immediately test the dashboard, fees, and attendance features.

## Stopping the Server

Press `Ctrl + C` in the Command Prompt window to stop the server.

## License

MIT