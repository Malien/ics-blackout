import z from "zod"
import { Temporal } from "temporal-polyfill"

const UpstreamResponseSchema = z
  .object({
    eventDate: z.string().transform(str => {
      const match = /(?<day>\d\d?).(?<month>\d\d?).(?<year>\d\d\d\d)/.exec(str)
      if (!match) throw new Error("Invalid date format")
      const { year, month, day } = match.groups as { year: string; month: string; day: string }
      return Temporal.PlainDate.from({
        year: +year,
        month: +month,
        day: +day,
      })
    }),
    queues: z.object({
      "1.2": z
        .object({
          from: z.string().transform(str => Temporal.PlainTime.from(str)),
          to: z.string().transform(str => Temporal.PlainTime.from(str)),
        })
        .array(),
    }),
    createdAt: z.string().transform(str => {
      const match =
        /(?<day>\d\d?).(?<month>\d\d?).(?<year>\d\d\d\d) (?<hour>\d\d?):(?<minute>\d\d?)/.exec(str)
      if (!match) throw new Error("Invalid date format")
      const groups = match.groups as Record<"year" | "month" | "day" | "hour" | "minute", string>
      return Temporal.ZonedDateTime.from({
        year: +groups.year,
        month: +groups.month,
        day: +groups.day,
        hour: +groups.hour,
        minute: +groups.minute,
        timeZone: "Europe/Kyiv",
      })
    }),
  })
  .array()

function toICSDatetimeString(
  datetime: Temporal.ZonedDateTime,
  { as }: { as: "DTSTART" | "DTEND" | "DTSTAMP" },
) {
  const year = datetime.year.toString().padStart(4, "0")
  const month = datetime.month.toString().padStart(2, "0")
  const day = datetime.day.toString().padStart(2, "0")
  const hour = datetime.hour.toString().padStart(2, "0")
  const minute = datetime.minute.toString().padStart(2, "0")
  const second = datetime.second.toString().padStart(2, "0")

  return `${as};TZID=${datetime.timeZoneId}:${year}${month}${day}T${hour}${minute}${second}`
}

export default {
  async fetch(request, _env, _ctx): Promise<Response> {
    const url = new URL(request.url)
    new URLPattern().exec()
    if (url.pathname !== "/if/q1.2.ics") {
      return new Response("Not found", { status: 404 })
    }
    const response = await fetch("https://be-svitlo.oe.if.ua/schedule-by-queue?queue=1.2")
    const data = UpstreamResponseSchema.parse(await response.json())

    let calendar = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Ivano-Frankivsk Outages//Queue 1.2//EN`

    for (const date of data) {
      if (!("1.2" in date.queues)) continue

      for (const period of date.queues["1.2"]) {
        const start = date.eventDate.toPlainDateTime(period.from).toZonedDateTime("Europe/Kyiv")
        const end = date.eventDate.toPlainDateTime(period.to).toZonedDateTime("Europe/Kyiv")

        calendar += `
BEGIN:VEVENT
UID:${start.toString()}@if-outage
${toICSDatetimeString(date.createdAt, { as: "DTSTAMP" })}
${toICSDatetimeString(start, { as: "DTSTART" })}
${toICSDatetimeString(end, { as: "DTEND" })}
SUMMARY:Power Outage
DESCRIPTION:Scheduled blackout in Ivano-Frankivsk oblast. Queue 1.2
CLASS:PUBLIC
TRANSP:TRANSPARENT
END:VEVENT`
      }
    }

    calendar += "\nEND:VCALENDAR"

    return new Response(calendar, {
      headers: {
        "Content-Type": "text/calendar;charset=utf-8",
      },
    })
  },
} satisfies ExportedHandler<Env>
