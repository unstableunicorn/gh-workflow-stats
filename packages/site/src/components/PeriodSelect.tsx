// The period filter shared by every view: a select over DAY_CHOICES.

import {DAY_CHOICES, type Days} from '../lib/route'

interface Props {
  value: Days
  onChange: (days: Days) => void
}

export function PeriodSelect({value, onChange}: Props) {
  return (
    <label>
      Period{' '}
      <select
        value={String(value)}
        onChange={e => {
          const days = DAY_CHOICES.find(
            d => String(d) === e.currentTarget.value
          )
          if (days !== undefined) onChange(days)
        }}
      >
        {DAY_CHOICES.map(d => (
          <option key={d} value={String(d)}>
            {d === 'all' ? 'All history' : `Last ${d} days`}
          </option>
        ))}
      </select>
    </label>
  )
}
