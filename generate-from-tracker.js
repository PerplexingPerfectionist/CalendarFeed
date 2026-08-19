const fs = require('fs');
const path = require('path');

const TRACKER_PATH = path.join(__dirname, '../memory/movie-tracker.md');
const OUTPUT_FILE = path.join(__dirname, 'calendars/movie-tracker.ics');

function escapeIcs(str) {
  if (!str) return '';
  return str
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function uidFor(title, year, month, day) {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 40);
  const d = `${year}${String(month + 1).padStart(2, '0')}${String(day).padStart(2, '0')}`;
  return `${slug}-${d}@capitol-bghorror`;
}

function formatIcsDateTime(year, month, day, hour, minute) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${year}${pad(month + 1)}${pad(day)}T${pad(hour)}${pad(minute)}00`;
}

function parseTracker(md) {
  const events = [];
  const lines = md.split('\n');
  let inUpcoming = false;

  for (const line of lines) {
    if (line.startsWith('## Upcoming Screenings')) {
      inUpcoming = true;
      continue;
    }
    if (inUpcoming && line.startsWith('## ')) {
      break;
    }
    if (inUpcoming && line.startsWith('|') && !line.includes('Movie') && !line.includes('---')) {
      const parts = line.split('|').map(p => p.trim()).filter(Boolean);
      if (parts.length >= 4) {
        const [movie, dateStr, timeStr, status, source] = parts;
        events.push({ movie, dateStr, timeStr, source: source || 'Capitol' });
      }
    }
  }
  return events;
}

function parseDateTime(dateStr, timeStr) {
  // dateStr like "Sun, Aug 2" or "Mon, Sep 8"
  // timeStr like "7:00 pm"
  const now = new Date();
  const year = now.getFullYear();
  
  const monthMap = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
  };
  
  const dateMatch = dateStr.toLowerCase().match(/([a-z]{3}),?\s+([a-z]{3})\s+(\d{1,2})/);
  if (!dateMatch) return null;
  
  const month = monthMap[dateMatch[2]];
  const day = parseInt(dateMatch[3], 10);
  
  const timeMatch = timeStr.toLowerCase().match(/(\d{1,2}):(\d{2})\s*(am|pm)/);
  if (!timeMatch) return null;
  
  let hour = parseInt(timeMatch[1], 10);
  const minute = parseInt(timeMatch[2], 10);
  const ampm = timeMatch[3];
  
  if (ampm === 'pm' && hour !== 12) hour += 12;
  if (ampm === 'am' && hour === 12) hour = 0;
  
  const d = new Date(year, month, day, hour, minute);
  
  // If the date is in the past, assume next year
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (d < today) {
    d.setFullYear(year + 1);
  }
  
  return { year: d.getFullYear(), month, day, hour, minute, dateObj: d };
}

function generateIcs(events) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Kimi Claw//BG Horror Club Movie Tracker//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Capitol Theatre Screenings',
    'X-WR-TIMEZONE:America/Chicago',
    'BEGIN:VTIMEZONE',
    'TZID:America/Chicago',
    'X-LIC-LOCATION:America/Chicago',
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:-0600',
    'TZOFFSETTO:-0500',
    'TZNAME:CDT',
    'DTSTART:19700308T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:-0500',
    'TZOFFSETTO:-0600',
    'TZNAME:CST',
    'DTSTART:19701101T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
    'END:STANDARD',
    'END:VTIMEZONE',
  ];

  for (const ev of events) {
    const parsed = parseDateTime(ev.dateStr, ev.timeStr);
    if (!parsed) {
      console.warn(`Could not parse date/time for: ${ev.movie}`);
      continue;
    }
    
    const { year, month, day, hour, minute, dateObj } = parsed;
    
    // Default 2 hour runtime if unknown
    const endHour = hour + 2;
    
    const uid = uidFor(ev.movie, year, month, day);
    const dtStart = formatIcsDateTime(year, month, day, hour, minute);
    const dtEnd = formatIcsDateTime(year, month, day, endHour, minute);
    
    const isHorrorClub = ev.source.toLowerCase().includes('horror');
    const summary = escapeIcs(ev.movie);
    const description = escapeIcs(
      isHorrorClub 
        ? `BG Horror Club screening at Capitol Theatre\nSource: BG Horror Club`
        : `Capitol Theatre screening\nSource: Capitol Theatre calendar`
    );
    const location = escapeIcs('Capitol Theatre, Bowling Green, KY');

    lines.push(
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTART;TZID=America/Chicago:${dtStart}`,
      `DTEND;TZID=America/Chicago:${dtEnd}`,
      `SUMMARY:${summary}`,
      `DESCRIPTION:${description}`,
      `LOCATION:${location}`,
      'END:VEVENT'
    );
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

async function main() {
  try {
    const md = fs.readFileSync(TRACKER_PATH, 'utf8');
    const events = parseTracker(md);
    
    if (events.length === 0) {
      console.log('No upcoming events found in tracker.');
      return;
    }
    
    const ics = generateIcs(events);
    fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
    fs.writeFileSync(OUTPUT_FILE, ics, 'utf8');
    console.log(`Wrote ${events.length} event(s) to ${OUTPUT_FILE}`);
    
    for (const ev of events) {
      console.log(`  - ${ev.movie} (${ev.dateStr} ${ev.timeStr})`);
    }
  } catch (err) {
    console.error('Failed to generate calendar:', err.message);
    process.exit(1);
  }
}

main();
