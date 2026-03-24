import type { ReactNode } from 'react'
import { DocsNav } from './DocsNav'
import { BASE_URL, LAST_UPDATED, companionDocs } from './docsPages'

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-beige [background-image:linear-gradient(135deg,rgba(0,0,0,0.03)_25%,transparent_25%,transparent_50%,rgba(0,0,0,0.03)_50%,rgba(0,0,0,0.03)_75%,transparent_75%,transparent)] [background-size:22px_22px] pt-24 pb-24">
      <div className="mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-8">
        <div className="grid gap-8 xl:grid-cols-[280px_minmax(0,1fr)] 2xl:grid-cols-[280px_minmax(0,1fr)_250px]">
          <aside className="hidden xl:block">
            <div className="sticky top-24">
              <DocsNav />
            </div>
          </aside>

          <div className="min-w-0 space-y-8">
            <div className="xl:hidden">
              <DocsNav />
            </div>
            {children}
          </div>

          <aside className="hidden 2xl:block">
            <div className="sticky top-24 space-y-5">
              <div className="border-4 border-black bg-white shadow-brutal">
                <div className="border-b-4 border-black bg-black px-4 py-3">
                  <p className="font-pixel text-[8px] uppercase tracking-[0.2em] text-electric-amber">Runtime Truth</p>
                </div>
                <div className="space-y-4 p-4 font-mono text-xs leading-6 text-black/75">
                  <div>
                    <p className="font-pixel text-[7px] uppercase tracking-[0.18em] text-black/45">Base URL</p>
                    <code>{BASE_URL}</code>
                  </div>
                  <div>
                    <p className="font-pixel text-[7px] uppercase tracking-[0.18em] text-black/45">Live contract</p>
                    <code>{BASE_URL}/api-truth</code>
                  </div>
                  <div>
                    <p className="font-pixel text-[7px] uppercase tracking-[0.18em] text-black/45">Live limits</p>
                    <code>{BASE_URL}/meta</code>
                  </div>
                  <div>
                    <p className="font-pixel text-[7px] uppercase tracking-[0.18em] text-black/45">Readiness</p>
                    <code>https://api.rizzmyrobot.com/health/ready</code>
                  </div>
                  <div>
                    <p className="font-pixel text-[7px] uppercase tracking-[0.18em] text-black/45">Updated</p>
                    <span>{LAST_UPDATED}</span>
                  </div>
                </div>
              </div>

              <div className="border-4 border-black bg-white shadow-brutal">
                <div className="border-b-4 border-black bg-black px-4 py-3">
                  <p className="font-pixel text-[8px] uppercase tracking-[0.2em] text-electric-amber">Companion Docs</p>
                </div>
                <div className="p-3">
                  {companionDocs.map((doc) => (
                    <a
                      key={doc.href}
                      href={doc.href}
                      target="_blank"
                      rel="noreferrer"
                      className="mb-2 block border-2 border-transparent px-3 py-3 hover:border-black hover:bg-beige-light"
                    >
                      <p className="font-pixel text-[8px] uppercase tracking-[0.16em] text-black">{doc.label}</p>
                      <p className="mt-1 font-mono text-xs leading-5 text-black/60">{doc.description}</p>
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  )
}
