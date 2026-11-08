<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture
- Draft and review deletion uses the shared confirmation control `DeleteContractButton` with authenticated owner-scoped deletes and list-cache invalidation; review messages are removed by the existing cascading thread foreign key.
- Signed-in pages live under `src/routes/_authenticated/`; AI calls (drafting, review chat) run only in server functions in `src/lib/lease.functions.ts` with `requireSupabaseAuth`, so prompts and keys never reach the browser.
- Lease fields remain in `src/lib/lease.ts`; NDA fields, contract-type dispatch, shared required-field validation and upload language checks live in `src/lib/contracts.ts`, so drafting and review agree on supported contract types.
- Lease and NDA drafts share the existing owner-scoped draft storage; only NDA params carry `contractType: "nda"`, so legacy lease drafts stay compatible without a schema change. NDA field presentation lives in `NdaFields` while both types retain the shared content editor.
- Post-draft manual editing stays in `DraftContentEditor` and saves through the authenticated client with existing row policies; in-document pop-ups use position-based replacements, matching explicit labels or unambiguous context for autofill rather than treating every anonymous blank as the same information.
