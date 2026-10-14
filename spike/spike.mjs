// Этап 0: проверка, что Agent SDK работает на вашей подписке, и замер задержки.
// Запуск: npm run spike [-- путь/к/картинке.jpg] [--model claude-haiku-5-5]
import { readFileSync } from 'node:fs'
import { query } from '@anthropic-ai/claude-agent-sdk'

const args = process.argv.slice(2)
const modelIdx = args.indexOf('--model')
const model = modelIdx >= 0 ? args.splice(modelIdx, 2)[1] : 'claude-sonnet-5-5'
const imagePath = args[0]

const env = { ...process.env }
delete env.ANTHROPIC_API_KEY // иначе SDK возьмёт ключ, а не подписку
delete env.ANTHROPIC_AUTH_TOKEN

const content = []
if (imagePath) {
  const mediaType = imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg'
  content.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: readFileSync(imagePath).toString('base64') } })
}
content.push({ type: 'text', text: imagePath ? 'Что на этой картинке? Одним абзацем.' : 'Скажи «привет» и назови себя одной фразой.' })

async function* prompt() {
  yield { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null }
}

const t0 = Date.now()
let ttft
const q = query({
  prompt: prompt(),
  options: { model, tools: [], maxTurns: 1, settingSources: [], includePartialMessages: true, env }
})
const account = await q.accountInfo()
console.log('Аккаунт:', account)
for await (const m of q) {
  if (m.type === 'stream_event' && m.event.type === 'content_block_delta' && m.event.delta.type === 'text_delta') {
    ttft ??= Date.now() - t0
    process.stdout.write(m.event.delta.text)
  }
  if (m.type === 'result') {
    console.log(`\n\nМодель: ${model}`)
    console.log(`Первый токен: ${ttft} мс, всего: ${Date.now() - t0} мс`)
    console.log('Токены:', m.usage)
    if (m.subtype !== 'success') console.log('Ошибка:', m.subtype)
  }
}
