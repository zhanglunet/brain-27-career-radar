const databaseId = process.env.BRAIN_RADAR_D1_ID?.trim();

if (!databaseId) {
  console.error("BRAIN_RADAR_D1_ID is required for production deployment.");
  process.exit(1);
}

console.log(JSON.stringify({ event: "radar.deploy.preflight", d1Configured: true }));
