-- C34 (S66): a template upload's guards. Only the status, the reason, the version it produced and the finish time change,
-- the status only moves forward (queued, reading, then one of done, failed, needs_human), an upload is never deleted,
-- and the table can't be emptied.
CREATE OR REPLACE FUNCTION template_upload_rank(s text) RETURNS int AS $$
  SELECT CASE s WHEN 'queued' THEN 0 WHEN 'reading' THEN 1 ELSE 2 END;
$$ LANGUAGE sql IMMUTABLE;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION template_uploads_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'template_uploads: an upload is never deleted';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.template_id IS DISTINCT FROM OLD.template_id
     OR NEW.doc_hash IS DISTINCT FROM OLD.doc_hash OR NEW.storage_key IS DISTINCT FROM OLD.storage_key
     OR NEW.file_name IS DISTINCT FROM OLD.file_name OR NEW.declared_no_real_data IS DISTINCT FROM OLD.declared_no_real_data
     OR NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by OR NEW.uploaded_at IS DISTINCT FROM OLD.uploaded_at THEN
    RAISE EXCEPTION 'template_uploads: only the status, reason, version and finish time change';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND template_upload_rank(NEW.status) <= template_upload_rank(OLD.status) THEN
    RAISE EXCEPTION 'template_uploads: the status only moves forward (% to % refused)', OLD.status, NEW.status;
  END IF;
  IF OLD.status IN ('done', 'failed', 'needs_human') AND (
     NEW.status IS DISTINCT FROM OLD.status OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.version_id IS DISTINCT FROM OLD.version_id OR NEW.finished_at IS DISTINCT FROM OLD.finished_at) THEN
    RAISE EXCEPTION 'template_uploads: a finished upload never changes';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER template_uploads_guard
  BEFORE UPDATE OR DELETE ON template_uploads
  FOR EACH ROW EXECUTE FUNCTION template_uploads_guard();
--> statement-breakpoint
CREATE TRIGGER template_uploads_no_truncate
  BEFORE TRUNCATE ON template_uploads
  FOR EACH STATEMENT EXECUTE FUNCTION spa_truncate_refused();
