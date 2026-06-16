const CALENDAR_API = 'https://www.googleapis.com/calendar/v3'

export async function fetchCalendarEvents(accessToken, calendarId, timeMin, timeMax) {
  const events = []
  let pageToken = null

  do {
    const params = new URLSearchParams({
      singleEvents: 'true',
      orderBy: 'startTime',
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      maxResults: '2500',
    })
    if (pageToken) params.set('pageToken', pageToken)

    const url = `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Calendar API ${res.status}: ${body}`)
    }

    const data = await res.json()
    if (data.items) events.push(...data.items)
    pageToken = data.nextPageToken ?? null
  } while (pageToken)

  return events
}
