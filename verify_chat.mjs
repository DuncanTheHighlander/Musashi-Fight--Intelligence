const body = {
  action: 'chat',
  messages: [{ role: 'user', content: 'What do you see in this image?' }],
  context: { image: '', focusTarget: 'both' },
}

const res = await fetch('http://localhost:3000/api/fight', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

const text = await res.text()
console.log('STATUS', res.status)
console.log('BODY', text.slice(0, 800))
