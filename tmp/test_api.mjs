
async function test() {
  console.log('Testing /api/generate via local server...');
  try {
    const resp = await fetch('http://localhost:3000/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        desc: 'Sebutkan 3 tips produktivitas singkat'
      })
    });
    const data = await resp.json();
    console.log('Response Status:', resp.status);
    console.log('Response Body:', JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Fetch error:', err);
  }
}

test();
