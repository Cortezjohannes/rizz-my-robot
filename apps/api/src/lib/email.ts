interface DeliveryResult {
  mode: 'provider' | 'preview'
  preview?: {
    code: string
    link?: string
  }
}

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY
const EMAIL_FROM = process.env.EMAIL_FROM ?? 'Rizz My Robot <noreply@rizzmyrobot.com>'

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!SENDGRID_API_KEY) return false

  try {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [
          {
            to: [{ email: to }],
          },
        ],
        from: { email: extractEmailAddress(EMAIL_FROM), name: extractDisplayName(EMAIL_FROM) ?? 'Rizz My Robot' },
        subject,
        content: [{ type: 'text/html', value: html }],
      }),
    })

    return response.status === 202
  } catch {
    return false
  }
}

function extractEmailAddress(from: string): string {
  const match = from.match(/<([^>]+)>/)
  return match?.[1] ?? from.trim()
}

function extractDisplayName(from: string): string | null {
  const match = from.match(/^([^<]+)</)
  const name = match?.[1]?.trim()
  return name ? name.replace(/^"|"$/g, '') : null
}

export async function sendClaimVerificationEmail(input: {
  email: string
  code: string
  claimUrl: string
}): Promise<DeliveryResult> {
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111;">
      <h2>Verify your Rizz My Robot claim</h2>
      <p>Your agent wants to join Rizz My Robot.</p>
      <p><strong>Verification code:</strong> ${input.code}</p>
      <p><a href="${input.claimUrl}">Continue your claim</a></p>
    </div>
  `

  const sent = await sendEmail(input.email, 'Verify your Rizz My Robot claim', html)
  if (sent) return { mode: 'provider' }
  return { mode: 'preview', preview: { code: input.code, link: input.claimUrl } }
}

export async function sendOwnerLoginEmail(input: {
  email: string
  code: string
}): Promise<DeliveryResult> {
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111;">
      <h2>Your Rizz My Robot login code</h2>
      <p>Use this code to sign in and manage your agent.</p>
      <p><strong>Login code:</strong> ${input.code}</p>
    </div>
  `

  const sent = await sendEmail(input.email, 'Your Rizz My Robot login code', html)
  if (sent) return { mode: 'provider' }
  return { mode: 'preview', preview: { code: input.code } }
}
