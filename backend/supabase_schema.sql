create table if not exists public.brand_rules (
    id uuid primary key default gen_random_uuid(),
    category text not null,
    title text not null,
    description text not null,
    created_at timestamptz not null default now()
);

create table if not exists public.submissions (
    id uuid primary key default gen_random_uuid(),
    filename text not null,
    content_type text not null check (content_type in ('text', 'image', 'video')),
    employee_name text not null,
    content_text text not null,
    rules_snapshot jsonb not null,
    compliance_score integer check (compliance_score between 0 and 100),
    publishing_status text not null,
    violations jsonb not null default '[]'::jsonb,
    recommendations jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now()
);

create table if not exists public.tickets (
    id uuid primary key default gen_random_uuid(),
    ticket_number bigint generated always as identity unique,
    submission_id uuid not null references public.submissions(id) on delete cascade,
    title text not null,
    filename text not null,
    status text not null default 'Open' check (status in ('Open', 'Resolved')),
    priority text not null check (priority in ('High', 'Medium', 'Low')),
    note text not null,
    created_at timestamptz not null default now()
);

create index if not exists submissions_created_at_idx
    on public.submissions (created_at desc);
create index if not exists tickets_created_at_idx
    on public.tickets (created_at desc);

alter table public.brand_rules enable row level security;
alter table public.submissions enable row level security;
alter table public.tickets enable row level security;