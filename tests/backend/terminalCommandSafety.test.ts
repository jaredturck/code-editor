import { describe, expect, it } from 'vitest'
import { isProcessTerminationCommand } from '../../backend/desktopBridge/services/terminalCommandService'

describe('terminal command process safety', () => {
  it('blocks direct process termination commands', () => {
    expect(isProcessTerminationCommand('kill 1234')).toBe(true)
    expect(isProcessTerminationCommand('pkill -f vite')).toBe(true)
    expect(isProcessTerminationCommand('killall node')).toBe(true)
    expect(isProcessTerminationCommand('taskkill /PID 1234 /F')).toBe(true)
  })

  it('blocks common port-reclamation process killers', () => {
    expect(isProcessTerminationCommand('kill $(lsof -t -i:5173)')).toBe(true)
    expect(isProcessTerminationCommand('lsof -ti:5173 | xargs kill -9')).toBe(true)
    expect(isProcessTerminationCommand('fuser -k 5173/tcp')).toBe(true)
    expect(isProcessTerminationCommand('npx kill-port 5173')).toBe(true)
    expect(isProcessTerminationCommand('pnpm dlx kill-port 5173')).toBe(true)
  })

  it('blocks scripted process termination APIs', () => {
    expect(isProcessTerminationCommand('node -e "process.kill(1234)"')).toBe(true)
    expect(isProcessTerminationCommand('python -c "import os; os.kill(1234, 9)"')).toBe(true)
    expect(isProcessTerminationCommand('powershell -Command "Stop-Process -Id 1234"')).toBe(true)
  })

  it('does not block normal project commands or process inspection', () => {
    expect(isProcessTerminationCommand('npm run dev')).toBe(false)
    expect(isProcessTerminationCommand('npm run build')).toBe(false)
    expect(isProcessTerminationCommand('ps aux')).toBe(false)
    expect(isProcessTerminationCommand('lsof -i:5173')).toBe(false)
  })
})
