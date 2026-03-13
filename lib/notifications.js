// Get recent non-Saturday dates going back from yesterday
function getCheckDays(count) {
  const days = []
  const d = new Date()
  d.setDate(d.getDate() - 1)
  while (days.length < count) {
    if (d.getDay() !== 6) { // skip Saturday (6)
      days.push(d.toISOString().split('T')[0])
    }
    d.setDate(d.getDate() - 1)
  }
  return days
}

function formatDateShort(dateStr) {
  return new Date(dateStr).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}

/**
 * Compute missing-report notifications from members & reports.
 * @param {Array} members - profiles (managers/teamleads) to check
 * @param {Array} reports - all reports for those members
 * @returns {{ missing: Array, streaks: Array }}
 *   missing — members who didn't submit a report for the last working day
 *   streaks — members with 3+ consecutive working days without a report
 */
export function getMissingReportAlerts(members, reports) {
  const checkDays = getCheckDays(7)
  if (checkDays.length === 0) return { missing: [], streaks: [] }

  const yesterday = checkDays[0]

  // Build lookup: manager_id → Set of report dates
  const byManager = new Map()
  reports.forEach(r => {
    if (!byManager.has(r.manager_id)) byManager.set(r.manager_id, new Set())
    byManager.get(r.manager_id).add(r.date)
  })

  const missing = []
  const streaks = []

  members.forEach(member => {
    const dates = byManager.get(member.id) || new Set()

    // Yesterday's report missing
    if (!dates.has(yesterday)) {
      missing.push({
        id: member.id,
        name: member.name || member.email,
        team: member.team,
        role: member.role,
        date: yesterday,
        dateFormatted: formatDateShort(yesterday),
      })
    }

    // Count consecutive missing working days from yesterday
    let consecutive = 0
    for (const day of checkDays) {
      if (!dates.has(day)) consecutive++
      else break
    }

    if (consecutive >= 3) {
      streaks.push({
        id: member.id,
        name: member.name || member.email,
        team: member.team,
        role: member.role,
        days: consecutive,
      })
    }
  })

  return { missing, streaks }
}
