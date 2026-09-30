-- Link a feedback item to the GitHub Issue created from it (so we can show the
-- link, avoid double-posting, and jump to the issue on the project board).
ALTER TABLE feedback
  ADD COLUMN github_issue_number INT NULL,
  ADD COLUMN github_issue_url VARCHAR(300) NULL;
