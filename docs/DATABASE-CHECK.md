# Database Check Runbook

Use this guide to check your production database safely whenever needed.

## 1) Open terminal in the server folder

```bash
cd /Users/jamesjonathantossou-ayayi/Desktop/codequest-ai-tutor/server
```

## 2) Set your database URL for this terminal session

Copy your **External Database URL** from Render and export it:

```bash
export DATABASE_URL='PASTE_YOUR_RENDER_EXTERNAL_DATABASE_URL'
```

## 3) Verify database connectivity

```bash
node --input-type=module -e 'import pg from "pg"; const c=new pg.Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}}); await c.connect(); const r=await c.query("select now()"); console.table(r.rows); await c.end();'
```

## 4) List latest user accounts

```bash
node --input-type=module -e 'import pg from "pg"; const c=new pg.Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}}); await c.connect(); const r=await c.query(`SELECT id,email,role,plan,subscription_status,created_at FROM users ORDER BY created_at DESC LIMIT 100`); console.table(r.rows); await c.end();'
```

## 5) Count total users

```bash
node --input-type=module -e 'import pg from "pg"; const c=new pg.Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}}); await c.connect(); const r=await c.query(`SELECT COUNT(*)::int AS total_users FROM users`); console.table(r.rows); await c.end();'
```

## 6) Count users who sent at least one chat message

```bash
node --input-type=module -e 'import pg from "pg"; const c=new pg.Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}}); await c.connect(); const r=await c.query(`SELECT COUNT(DISTINCT user_id)::int AS users_with_chat FROM chat_messages WHERE role = '\''user'\''`); console.table(r.rows); await c.end();'
```

## 7) Count paid users

```bash
node --input-type=module -e 'import pg from "pg"; const c=new pg.Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}}); await c.connect(); const r=await c.query(`SELECT COUNT(*)::int AS paid_users FROM users WHERE plan IN ('\''pro'\'','\''premium'\'')`); console.table(r.rows); await c.end();'
```

## 8) Clear env var when done

```bash
unset DATABASE_URL
```

## Troubleshooting

- `ENOTFOUND`: host is wrong or URL was pasted incorrectly.
- `28P01 password authentication failed`: password/user is wrong.
- `relation "users" does not exist`: connected to the wrong database.

## Security Notes

- Do not commit real `DATABASE_URL` credentials into git.
- If credentials are ever exposed, rotate them in Render immediately.
