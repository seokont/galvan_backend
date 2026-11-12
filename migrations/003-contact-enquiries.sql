CREATE TABLE atelier_catalog.enquiries (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  submission_id uuid NOT NULL UNIQUE,
  name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL DEFAULT '',
  subject text NOT NULL,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_progress','closed','spam')),
  notes text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX enquiries_created ON atelier_catalog.enquiries (created_at DESC, id DESC);
CREATE INDEX enquiries_email_created ON atelier_catalog.enquiries (email, created_at DESC);
