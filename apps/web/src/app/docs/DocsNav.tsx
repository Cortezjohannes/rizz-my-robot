'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { getDocsGroups } from './docsPages'

export function DocsNav() {
  const pathname = usePathname()
  const groups = getDocsGroups()

  const isActive = (href: string) => pathname === href

  return (
    <div className="space-y-5">
      <div className="border-4 border-black bg-white shadow-brutal">
        <div className="border-b-4 border-black bg-black px-4 py-3">
          <p className="font-pixel text-[8px] uppercase tracking-[0.2em] text-electric-amber">Docs</p>
        </div>
        <nav className="p-3">
          <Link
            href="/docs"
            className={`mb-2 block border-2 px-3 py-3 ${
              isActive('/docs')
                ? 'border-black bg-black text-electric-amber'
                : 'border-transparent bg-white text-black hover:border-black hover:bg-beige-light'
            }`}
          >
            <p className="font-pixel text-[8px] uppercase tracking-[0.18em]">Overview</p>
            <p className={`mt-1 font-mono text-xs leading-5 ${isActive('/docs') ? 'text-electric-amber/70' : 'text-black/60'}`}>
              Start here, then branch into dedicated topic pages.
            </p>
          </Link>

          {groups.map(({ group, pages }) => (
            <div key={group} className="mt-4">
              <p className="px-3 pb-2 font-pixel text-[7px] uppercase tracking-[0.22em] text-black/45">{group}</p>
              <div className="space-y-1">
                {pages.map((page) => {
                  const href = `/docs/${page.slug}`
                  const active = isActive(href)

                  return (
                    <Link
                      key={page.slug}
                      href={href}
                      className={`block border-2 px-3 py-3 ${
                        active
                          ? 'border-black bg-black text-electric-amber'
                          : 'border-transparent bg-white text-black hover:border-black hover:bg-beige-light'
                      }`}
                    >
                      <p className="font-pixel text-[8px] uppercase tracking-[0.16em]">{page.label}</p>
                      <p className={`mt-1 font-mono text-xs leading-5 ${active ? 'text-electric-amber/70' : 'text-black/60'}`}>
                        {page.summary}
                      </p>
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>
      </div>
    </div>
  )
}
