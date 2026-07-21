require('dotenv').config()
const { Pool } = require("pg")

if (!process.env.DATABASE_URL) {
  console.error("\n❌ DATABASE ERROR: The 'DATABASE_URL' environment variable is not defined in your .env file!")
  console.error("Please add your Supabase connection string to the .env file.\n")
  process.exit(1)
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
})

console.log("\nDATABASE CONNECTION (Supabase): ✅")

module.exports = pool