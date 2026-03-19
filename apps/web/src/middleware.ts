import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

const DIRECT_OMNIMON_PATH = '/omnimon'
const DIRECT_ADMIN_PATH = '/internal'
const INTERNAL_CONTROL_PREFIX = '/__control'
const HIDDEN_OMNIMON_TARGET = '/__control/omnimon'
const HIDDEN_ADMIN_TARGET = '/__control/admin'

function normalizeHiddenPath(raw: string | undefined | null): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  if (withLeadingSlash.length > 1 && withLeadingSlash.endsWith('/')) {
    return withLeadingSlash.slice(0, -1)
  }
  return withLeadingSlash
}

function getConfiguredPath(envName: 'OMNIMON_CONTROL_PATH' | 'ADMIN_CONTROL_PATH'): string | null {
  const configured = normalizeHiddenPath(process.env[envName])
  if (configured) return configured
  if (process.env.NODE_ENV !== 'production') {
    return envName === 'OMNIMON_CONTROL_PATH' ? DIRECT_OMNIMON_PATH : DIRECT_ADMIN_PATH
  }
  return null
}

function isDirectPath(pathname: string, directPath: string): boolean {
  return pathname === directPath || pathname.startsWith(`${directPath}/`)
}

function notFound(): NextResponse {
  return new NextResponse('Not Found', { status: 404 })
}

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  const hiddenOmnimonPath = getConfiguredPath('OMNIMON_CONTROL_PATH')
  const hiddenAdminPath = getConfiguredPath('ADMIN_CONTROL_PATH')

  if (pathname === INTERNAL_CONTROL_PREFIX || pathname.startsWith(`${INTERNAL_CONTROL_PREFIX}/`)) {
    return notFound()
  }

  const usingHiddenOmnimonPath = hiddenOmnimonPath && hiddenOmnimonPath !== DIRECT_OMNIMON_PATH
  const usingHiddenAdminPath = hiddenAdminPath && hiddenAdminPath !== DIRECT_ADMIN_PATH
  const hideDirectOmnimonPath = process.env.NODE_ENV === 'production' || Boolean(usingHiddenOmnimonPath)
  const hideDirectAdminPath = process.env.NODE_ENV === 'production' || Boolean(usingHiddenAdminPath)

  if (hideDirectOmnimonPath && isDirectPath(pathname, DIRECT_OMNIMON_PATH)) {
    return notFound()
  }

  if (hideDirectAdminPath && isDirectPath(pathname, DIRECT_ADMIN_PATH)) {
    return notFound()
  }

  if (hiddenOmnimonPath && pathname === hiddenOmnimonPath) {
    const url = request.nextUrl.clone()
    url.pathname = HIDDEN_OMNIMON_TARGET
    return NextResponse.rewrite(url)
  }

  if (hiddenAdminPath && pathname === hiddenAdminPath) {
    const url = request.nextUrl.clone()
    url.pathname = HIDDEN_ADMIN_TARGET
    return NextResponse.rewrite(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)',
  ],
}
