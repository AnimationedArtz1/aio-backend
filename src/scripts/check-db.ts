import { Pool } from 'pg';

const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'casaos',
    user: 'casaos',
    password: 'casaos'
});

async function checkDatabase() {
    let client;
    try {
        console.log('=== DATABASE CONNECTION CHECK ===');
        console.log('Host: localhost:5432');
        console.log('Database: casaos');
        console.log('User: casaos');
        console.log('');

        client = await pool.connect();
        console.log('✅ Connected to PostgreSQL successfully!');

        const versionResult = await client.query('SELECT version()');
        console.log('PostgreSQL Version:', versionResult.rows[0].version.substring(0, 50) + '...');

        const dbSizeResult = await client.query(`
            SELECT pg_database.datname,
                   pg_size_pretty(pg_database_size(pg_database.datname)) AS size
            FROM pg_database
            WHERE pg_database.datname = 'casaos'
        `);
        console.log('Database Size:', dbSizeResult.rows[0].size);

        const tablesResult = await client.query(`
            SELECT tablename
            FROM pg_tables
            WHERE schemaname = 'public'
            ORDER BY tablename
        `);
        console.log('\nTables (' + tablesResult.rows.length + '):');
        tablesResult.rows.forEach(row => {
            console.log('  -', row.tablename);
        });

        if (tablesResult.rows.length > 0) {
            const agentsCheck = await client.query('SELECT COUNT(*) as count FROM agents WHERE 1=1');
            const tenantsCheck = await client.query('SELECT COUNT(*) as count FROM tenants WHERE 1=1');
            const verimorCheck = await client.query('SELECT COUNT(*) as count FROM verimor_numbers WHERE 1=1');

            console.log('\nRow Counts:');
            console.log('  - agents:', agentsCheck.rows[0].count);
            console.log('  - tenants:', tenantsCheck.rows[0].count);
            console.log('  - verimor_numbers:', verimorCheck.rows[0].count);
        }

        console.log('\n✅ Database check completed successfully!');

    } catch (error: any) {
        console.error('\n❌ Database Connection Error:');
        console.error('Error:', error.message);
        console.error('Code:', error.code);
        process.exit(1);
    } finally {
        if (client) {
            client.release();
        }
        await pool.end();
    }
}

checkDatabase();
