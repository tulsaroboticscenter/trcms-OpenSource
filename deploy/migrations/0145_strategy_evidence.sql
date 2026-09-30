-- Season Strategy — Evidence spine (Phase 3). A thin polymorphic linker so a goal
-- progress update or a portfolio capture can point at the evidence behind it — an
-- existing TRCMS record (impact log, outreach event, task, budget line, certification,
-- resource, file) or an external link. season_goal_updates.evidence_id and
-- portfolio_captures.evidence_id (added in 0141/0143) reference this table.
CREATE TABLE IF NOT EXISTS strategy_evidence (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  source_type  ENUM('impact_log','outreach_event','task','budget_line','certification','resource','file','portfolio_capture','external_link') NOT NULL DEFAULT 'external_link',
  source_id    INT NULL,
  external_url VARCHAR(1000) NULL,
  label        VARCHAR(255) NOT NULL,
  created_by_id INT NULL,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);
