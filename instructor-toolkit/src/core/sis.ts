// Bulk "Sync to SIS" toggling. Canvas only offers bulk *disable* natively; this
// enables or disables per assignment and checks Canvas's SIS rules first so a
// sync does not silently fail at grade-passback time.

import type { CanvasClient } from './canvasClient'
import type { DatedItem } from './courseModel'
import { errorText } from './bulkDates'

export interface SisRules {
  /** Account setting "Require due date for SIS sync". Teachers cannot read it, so it is a user choice. */
  requireDueDate: boolean
  /** Account setting for the SIS assignment name length; Canvas defaults to 255. */
  maxNameLength: number
}

export const DEFAULT_SIS_RULES: SisRules = { requireDueDate: true, maxNameLength: 255 }

export interface SisPlan {
  change: DatedItem[]
  blocked: { item: DatedItem; reason: string }[]
  unchanged: DatedItem[]
}

export function planSis(items: DatedItem[], enable: boolean, rules: SisRules): SisPlan {
  const plan: SisPlan = { change: [], blocked: [], unchanged: [] }
  for (const item of items) {
    if (!item.assignmentId) continue
    if (item.postToSis === enable) {
      plan.unchanged.push(item)
      continue
    }
    if (enable) {
      const dueDates = [item.base.due_at, ...item.overrides.map(o => o.due_at)]
      if (rules.requireDueDate && !item.base.due_at && !item.overrides.some(o => o.due_at)) {
        plan.blocked.push({ item, reason: 'No due date (your SIS requires one)' })
        continue
      }
      if (rules.requireDueDate && item.overrides.length && dueDates.some(d => !d)) {
        plan.blocked.push({ item, reason: 'Some sections or students have no due date' })
        continue
      }
      if (item.title.length > rules.maxNameLength) {
        plan.blocked.push({ item, reason: `Name is longer than ${rules.maxNameLength} characters` })
        continue
      }
      if (item.pointsPossible === null) {
        plan.blocked.push({ item, reason: 'Not graded (no points possible)' })
        continue
      }
    }
    plan.change.push(item)
  }
  return plan
}

const MUTATION = `mutation ToolkitPostToSis($id: ID!, $postToSis: Boolean!) {
  updateAssignment(input: {id: $id, postToSis: $postToSis}) {
    assignment { _id postToSis }
    errors { attribute message }
  }
}`

interface MutationResult {
  updateAssignment: { assignment: { _id: string; postToSis: boolean } | null; errors: { attribute: string; message: string }[] | null }
}

export async function setPostToSis(client: CanvasClient, courseId: string, assignmentId: string, enable: boolean): Promise<void> {
  try {
    const data = await client.graphql<MutationResult>(MUTATION, { id: assignmentId, postToSis: enable })
    const errors = data.updateAssignment.errors
    if (errors?.length) throw new Error(errors.map(e => `${e.attribute}: ${e.message}`).join('; '))
    return
  } catch (graphqlError) {
    // Fallback: the REST update endpoint accepts post_to_sis, although the docs do not list it.
    try {
      await client.put(`/api/v1/courses/${courseId}/assignments/${assignmentId}`, { assignment: { post_to_sis: enable } })
    } catch {
      throw graphqlError
    }
  }
}

export async function applySis(
  client: CanvasClient,
  courseId: string,
  items: DatedItem[],
  enable: boolean,
  report: (done: number, total: number) => void = () => {},
): Promise<{ applied: DatedItem[]; failed: { item: DatedItem; error: string }[] }> {
  const applied: DatedItem[] = []
  const failed: { item: DatedItem; error: string }[] = []
  for (const [i, item] of items.entries()) {
    try {
      await setPostToSis(client, courseId, item.assignmentId!, enable)
      item.postToSis = enable
      applied.push(item)
    } catch (e) {
      failed.push({ item, error: errorText(e) })
    }
    report(i + 1, items.length)
  }
  return { applied, failed }
}
