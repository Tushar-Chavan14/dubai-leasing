-- C32 (S64): the inventory's guards. A unit is placed in a building once; a project's code and its buildings are fixed
-- once a deal exists on the project; a published price list and its items never change and are never deleted; an item's
-- unit must sit in a building of the list's project; projects and buildings are never deleted; none of the four new tables
-- can be emptied.
CREATE OR REPLACE FUNCTION units_building_set_once() RETURNS trigger AS $$
BEGIN
  IF OLD.building_id IS NOT NULL AND NEW.building_id IS DISTINCT FROM OLD.building_id THEN
    RAISE EXCEPTION 'units: a unit stays in the building it was placed in (building can''t change)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER units_building_set_once
  BEFORE UPDATE OF building_id ON units
  FOR EACH ROW EXECUTE FUNCTION units_building_set_once();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION project_has_deal(pid uuid, pcode text) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM deals d
    JOIN units u ON u.id = d.unit_id
    JOIN buildings b ON b.id = u.building_id
    WHERE b.project_id = pid
  ) OR EXISTS (SELECT 1 FROM deals d WHERE d.project_code = pcode);
$$ LANGUAGE sql STABLE;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION projects_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'projects are never deleted';
  END IF;
  IF NEW.code IS DISTINCT FROM OLD.code AND project_has_deal(OLD.id, OLD.code) THEN
    RAISE EXCEPTION 'projects: the code can''t change once a deal exists on the project';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER projects_guard
  BEFORE UPDATE OR DELETE ON projects
  FOR EACH ROW EXECUTE FUNCTION projects_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION buildings_guard() RETURNS trigger AS $$
DECLARE
  pcode text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'buildings are never deleted';
  END IF;
  IF NEW.code IS DISTINCT FROM OLD.code OR NEW.name IS DISTINCT FROM OLD.name OR NEW.project_id IS DISTINCT FROM OLD.project_id THEN
    SELECT code INTO pcode FROM projects WHERE id = OLD.project_id;
    IF project_has_deal(OLD.project_id, pcode) THEN
      RAISE EXCEPTION 'buildings: a building can''t be renamed or moved once a deal exists on its project';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER buildings_guard
  BEFORE UPDATE OR DELETE ON buildings
  FOR EACH ROW EXECUTE FUNCTION buildings_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION price_lists_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.published_at IS NOT NULL THEN
    RAISE EXCEPTION 'price_lists: a published price list never changes and is never deleted (% refused)', TG_OP;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.version IS DISTINCT FROM OLD.version OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'price_lists: only publishing changes a draft price list';
  END IF;
  IF NEW.published_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM price_list_items WHERE price_list_id = OLD.id) THEN
    RAISE EXCEPTION 'price_lists: a price list needs at least one price before it is published';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER price_lists_guard
  BEFORE UPDATE OR DELETE ON price_lists
  FOR EACH ROW EXECUTE FUNCTION price_lists_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION price_list_items_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND EXISTS (SELECT 1 FROM price_lists WHERE id = OLD.price_list_id AND published_at IS NOT NULL) THEN
    RAISE EXCEPTION 'price_list_items: the price list is published, its prices never change (% refused)', TG_OP;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    IF EXISTS (SELECT 1 FROM price_lists WHERE id = NEW.price_list_id AND published_at IS NOT NULL) THEN
      RAISE EXCEPTION 'price_list_items: the price list is published, a new price needs a new version';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM price_lists l
      JOIN units u ON u.id = NEW.unit_id
      JOIN buildings b ON b.id = u.building_id
      WHERE l.id = NEW.price_list_id AND b.project_id = l.project_id
    ) THEN
      RAISE EXCEPTION 'price_list_items: the unit must be in a building of the price list''s project';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER price_list_items_guard
  BEFORE INSERT OR UPDATE OR DELETE ON price_list_items
  FOR EACH ROW EXECUTE FUNCTION price_list_items_guard();
--> statement-breakpoint
CREATE TRIGGER projects_no_truncate
  BEFORE TRUNCATE ON projects
  FOR EACH STATEMENT EXECUTE FUNCTION spa_truncate_refused();
--> statement-breakpoint
CREATE TRIGGER buildings_no_truncate
  BEFORE TRUNCATE ON buildings
  FOR EACH STATEMENT EXECUTE FUNCTION spa_truncate_refused();
--> statement-breakpoint
CREATE TRIGGER price_lists_no_truncate
  BEFORE TRUNCATE ON price_lists
  FOR EACH STATEMENT EXECUTE FUNCTION spa_truncate_refused();
--> statement-breakpoint
CREATE TRIGGER price_list_items_no_truncate
  BEFORE TRUNCATE ON price_list_items
  FOR EACH STATEMENT EXECUTE FUNCTION spa_truncate_refused();
