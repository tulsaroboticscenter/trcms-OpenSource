-- Resume builder: let a youth attach their own resume file.
--
-- Some youth build their resume here, download it, polish the format in another tool,
-- and want to re-upload that version as their resume on file. That uploaded file is
-- youth-owned, so it lives on resume_answers (which the youth controls) rather than on
-- fdp_progress.resume_url (which only the Dev Program manager can set).
--
-- A youth counts as having a resume on file when EITHER they finished the builder
-- (completed_at) OR they uploaded their own file (uploaded_url) — both are honoured.
ALTER TABLE resume_answers
  ADD COLUMN uploaded_url VARCHAR(500) NULL AFTER show_contact;
