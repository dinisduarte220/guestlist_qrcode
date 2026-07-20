const pool = require('./db');
const { hashPassword } = require('./auth');

async function seed() {
  console.log("Starting database seeding...");
  
  try {
    // 1. Delete existing data in reverse dependency order
    await pool.query('DELETE FROM event_purchases');
    await pool.query('DELETE FROM event_products');
    await pool.query('DELETE FROM event_admins');
    await pool.query('DELETE FROM banned_users');
    await pool.query('DELETE FROM tickets');
    await pool.query('DELETE FROM guestlist_entries');
    await pool.query('DELETE FROM guestlists');
    await pool.query('DELETE FROM promoters');
    await pool.query('DELETE FROM events');
    await pool.query('DELETE FROM teams');
    await pool.query('DELETE FROM producers');
    await pool.query('DELETE FROM users');
    
    console.log("Cleared existing data.");

    // 2. Insert Users (Client, Promoter, Producer, Staff)
    const clientPass = await hashPassword('client123');
    const promoterPass = await hashPassword('promoter123');
    const producerPass = await hashPassword('producer123');
    const staffPass = await hashPassword('staff123');

    const uClient = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, wallet_balance) 
       VALUES ('Dinis Cliente', 'client@guestlist.com', $1, 'client', 50.00) RETURNING id`,
      [clientPass]
    );
    const uPromoter = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, wallet_balance) 
       VALUES ('João Promoter', 'promoter@guestlist.com', $1, 'promoter', 0.00) RETURNING id`,
      [promoterPass]
    );
    const uProducer = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, wallet_balance) 
       VALUES ('VIP Events Producer', 'producer@guestlist.com', $1, 'producer', 1000.00) RETURNING id`,
      [producerPass]
    );
    const uStaff = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, wallet_balance) 
       VALUES ('Staff Portaria', 'staff@guestlist.com', $1, 'staff', 0.00) RETURNING id`,
      [staffPass]
    );

    const clientId = uClient.rows[0].id;
    const promoterUserId = uPromoter.rows[0].id;
    const producerUserId = uProducer.rows[0].id;
    const staffUserId = uStaff.rows[0].id;

    console.log("Inserted Users.");

    // 3. Insert Producer
    const prodRes = await pool.query(
      `INSERT INTO producers (user_id, company_name) 
       VALUES ($1, 'Lux Club Productions') RETURNING id`,
      [producerUserId]
    );
    const producerId = prodRes.rows[0].id;
    console.log("Inserted Producer.");

    // 4. Insert Team
    const teamRes = await pool.query(
      `INSERT INTO teams (producer_id, name, leader_id) 
       VALUES ($1, 'Team Lisbon', $2) RETURNING id`,
      [producerId, promoterUserId]
    );
    const teamId = teamRes.rows[0].id;
    console.log("Inserted Team.");

    // 5. Insert Promoter
    const promoRes = await pool.query(
      `INSERT INTO promoters (user_id, producer_id, team_id, promo_code, total_sales) 
       VALUES ($1, $2, $3, 'LISBONPR', 0) RETURNING id`,
      [promoterUserId, producerId, teamId]
    );
    const promoterId = promoRes.rows[0].id;
    console.log("Inserted Promoter.");

    // 6. Insert Events
    const event1 = await pool.query(
      `INSERT INTO events (producer_id, title, description, date, location, event_style, image_url, ticket_price, enabled_in_event_payments) 
       VALUES ($1, 'Neon Glow Night', 'The biggest neon EDM event of the summer! Glow paint, laser show and international DJs.', '2026-08-15 22:00:00', 'Lux Club, Lisbon', 'Electronic', 'neon_glow', 15.00, true) RETURNING id`,
      [producerId]
    );
    const event2 = await pool.query(
      `INSERT INTO events (producer_id, title, description, date, location, event_style, image_url, ticket_price, enabled_in_event_payments) 
       VALUES ($1, 'Summer Vibe Festival', 'A sunset experience with Latin beats, Reggaeton rhythms, and refreshing drinks near the ocean.', '2026-08-20 18:00:00', 'Praia da Rocha, Portimão', 'Latino/Reggaeton', 'summer_vibe', 25.00, true) RETURNING id`,
      [producerId]
    );
    const event3 = await pool.query(
      `INSERT INTO events (producer_id, title, description, date, location, event_style, image_url, ticket_price, enabled_in_event_payments) 
       VALUES ($1, 'Techno Basement Sessions', 'Pure dark techno. No cameras, no lights, just the beat.', '2026-08-28 23:00:00', 'Basement Club, Porto', 'Techno', 'techno_basement', 10.00, false) RETURNING id`,
      [producerId]
    );

    const event1Id = event1.rows[0].id;
    const event2Id = event2.rows[0].id;
    const event3Id = event3.rows[0].id;
    console.log("Inserted Events.");

    // 7. Associate Staff as Event Admin for Event 1
    await pool.query(
      `INSERT INTO event_admins (event_id, user_id) VALUES ($1, $2)`,
      [event1Id, staffUserId]
    );
    console.log("Inserted Event Admins.");

    // 8. Insert Guestlists
    await pool.query(
      `INSERT INTO guestlists (event_id, name, conditions, max_capacity) 
       VALUES ($1, 'GuestList Geral VIP', 'Entrada livre até 00h30. Mulheres: Livre, Homens: 10€ consumíveis com partilha de post.', 150)`,
      [event1Id]
    );
    await pool.query(
      `INSERT INTO guestlists (event_id, name, conditions, max_capacity) 
       VALUES ($1, 'GuestList Sunset Vibe', 'Entrada gratuita até às 19h00 com este passe.', 300)`,
      [event2Id]
    );
    console.log("Inserted Guestlists.");

    // 9. Insert Event Products
    // Event 1 products
    const p1 = await pool.query(`INSERT INTO event_products (event_id, name, price) VALUES ($1, 'Gin Tónico', 8.00) RETURNING id`, [event1Id]);
    const p2 = await pool.query(`INSERT INTO event_products (event_id, name, price) VALUES ($1, 'Cerveja Imperial', 3.50) RETURNING id`, [event1Id]);
    const p3 = await pool.query(`INSERT INTO event_products (event_id, name, price) VALUES ($1, 'Vodka Redbull', 10.00) RETURNING id`, [event1Id]);

    // Event 2 products
    await pool.query(`INSERT INTO event_products (event_id, name, price) VALUES ($1, 'Mojito', 7.50)`, [event2Id]);
    await pool.query(`INSERT INTO event_products (event_id, name, price) VALUES ($1, 'Caipirinha', 6.00)`, [event2Id]);
    await pool.query(`INSERT INTO event_products (event_id, name, price) VALUES ($1, 'Água Mineral', 2.00)`, [event2Id]);
    console.log("Inserted Event Products.");

    console.log("Database seeded successfully! ✅");
    console.log("\nCredentials to test:");
    console.log("-------------------");
    console.log("Producer:  producer@guestlist.com / producer123");
    console.log("Promoter:  promoter@guestlist.com / promoter123 (Promo Code: LISBONPR)");
    console.log("Client:    client@guestlist.com   / client123 (Wallet Balance: 50.00€)");
    console.log("Staff:     staff@guestlist.com    / staff123");
    
  } catch (err) {
    console.error("Error seeding database:", err);
  } finally {
    await pool.end();
  }
}

seed();
