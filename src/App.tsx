import ActivityBar from './components/ActivityBar'
import EditorPanel from './components/EditorPanel'
import ExplorerPanel from './components/ExplorerPanel'
import TerminalPanel from './components/TerminalPanel'
import TopBar from './components/TopBar'

function App() {
  return (
    <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-zinc-950 text-zinc-300">
      <TopBar />

      <div className="grid min-h-0 flex-1 grid-cols-[48px_260px_minmax(0,1fr)]">
        <ActivityBar />
        <ExplorerPanel />

        <main className="grid min-h-0 grid-rows-[minmax(0,1fr)_220px]">
          <EditorPanel />
          <TerminalPanel />
        </main>
      </div>
    </div>
  )
}

export default App
