import { format as dfFormat, formatDistanceToNow, parseISO, isValid } from 'date-fns'
import { vi, enUS } from 'date-fns/locale'

export type DateFormat = string

export interface DateTimeOptions {
  date?: Date | string | number | null
  format?: string
}

export const useDateTime = () => {
  const { locale } = useI18n()

  const defaultSettings = {
    date_format: 'dd/MM/yyyy',
    time_format: 'HH:mm',
    datetime_format: 'dd/MM/yyyy HH:mm',
    first_day_of_week: 1
  }

  const getDateFnsLocale = () => {
    return locale.value === 'vi' ? vi : enUS
  }

  const toDate = (date: Date | string | number | null | undefined): Date | null => {
    if (!date) return null
    const d = typeof date === 'string' ? parseISO(date) : new Date(date)
    return isValid(d) ? d : null
  }

  const formatDate = (date: Date | string | number | null | undefined, formatOverride?: string): string => {
    const d = toDate(date)
    if (!d) return ''
    return dfFormat(d, formatOverride || defaultSettings.date_format, { locale: getDateFnsLocale() })
  }

  const formatTime = (date: Date | string | number | null | undefined, formatOverride?: string): string => {
    const d = toDate(date)
    if (!d) return ''
    return dfFormat(d, formatOverride || defaultSettings.time_format, { locale: getDateFnsLocale() })
  }

  const formatDateTime = (date: Date | string | number | null | undefined, formatOverride?: string): string => {
    const d = toDate(date)
    if (!d) return ''
    return dfFormat(d, formatOverride || defaultSettings.datetime_format, { locale: getDateFnsLocale() })
  }

  const formatRelative = (date: Date | string | number | null | undefined): string => {
    const d = toDate(date)
    if (!d) return ''
    return formatDistanceToNow(d, { addSuffix: true, locale: getDateFnsLocale() })
  }

  const getDaysInWeek = () => {
    const days = []
    const firstDay = defaultSettings.first_day_of_week
    for (let i = 0; i < 7; i++) {
      const dayIndex = (firstDay + i) % 7
      const d = new Date(2024, 0, 7 + dayIndex)
      days.push({
        value: dayIndex,
        label: dfFormat(d, 'EEEE', { locale: getDateFnsLocale() })
      })
    }
    return days
  }

  const getDateFormatOptions = () => [
    { label: 'DD/MM/YYYY (31/12/2024)', value: 'dd/MM/yyyy' },
    { label: 'MM/DD/YYYY (12/31/2024)', value: 'MM/dd/yyyy' },
    { label: 'YYYY-MM-DD (2024-12-31)', value: 'yyyy-MM-dd' },
    { label: 'MMM dd, yyyy (Dec 31, 2024)', value: 'MMM dd, yyyy' },
    { label: 'dd MMM yyyy (31 Dec 2024)', value: 'dd MMM yyyy' }
  ]

  const getTimeFormatOptions = () => [
    { label: '24-hour (HH:mm)', value: 'HH:mm' },
    { label: '24-hour with seconds (HH:mm:ss)', value: 'HH:mm:ss' },
    { label: '12-hour (hh:mm a)', value: 'hh:mm a' },
    { label: '12-hour with seconds (hh:mm:ss a)', value: 'hh:mm:ss a' }
  ]

  const getDayOptions = () => [
    { label: locale.value === 'vi' ? 'Chủ nhật' : 'Sunday', value: 0 },
    { label: locale.value === 'vi' ? 'Thứ hai' : 'Monday', value: 1 },
    { label: locale.value === 'vi' ? 'Thứ ba' : 'Tuesday', value: 2 },
    { label: locale.value === 'vi' ? 'Thứ tư' : 'Wednesday', value: 3 },
    { label: locale.value === 'vi' ? 'Thứ năm' : 'Thursday', value: 4 },
    { label: locale.value === 'vi' ? 'Thứ sáu' : 'Friday', value: 5 },
    { label: locale.value === 'vi' ? 'Thứ bảy' : 'Saturday', value: 6 }
  ]

  return {
    formatDate,
    formatTime,
    formatDateTime,
    formatRelative,
    getDaysInWeek,
    getDateFormatOptions,
    getTimeFormatOptions,
    getDayOptions,
    toDate
  }
}
