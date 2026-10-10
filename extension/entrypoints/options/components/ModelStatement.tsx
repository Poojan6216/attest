/** What Chrome's on-device model sees, where it runs, and what it may do to a grade (sprint_5 5.2). */
export function ModelStatement() {
  return (
    <>
      <p class="text-sm">
        Off unless you turn it on. The model runs on this computer, inside Chrome: nothing is sent anywhere.
        For each claim it sees only what kind of action it was, who it was to, its short subject, its amount
        and its time, and the same for the one sent email or event it partly matched. It never sees a page or
        what you asked an agent.
      </p>
      <p class="text-sm">
        It never decides a grade. It can only move a partial match toward verified, and never lowers a grade.
      </p>
    </>
  );
}
