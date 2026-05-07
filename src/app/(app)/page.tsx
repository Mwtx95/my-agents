import { redirect } from 'next/navigation'

export default function AppIndex() {
  // PR 2 only ships PM in the sidebar. PR 3 will introduce the multi-agent
  // switcher and may change this default.
  redirect('/pm')
}
