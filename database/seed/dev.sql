-- DEVELOPMENT SAMPLE DATA. Fictional venues for local testing only.
update public.app_settings
   set institution_name = 'Demo College',
       campus_timezone  = 'Asia/Kolkata',     -- example value: use your campus IANA timezone
       support_email    = 'venues@demo.edu'
 where id = 1;

insert into public.venues (name, venue_type, building, location_details, capacity, description, amenities) values
  ('Main Auditorium',    'auditorium',      'Central Block',        'Ground floor',          600,
   'Large auditorium with stage and balcony seating for convocations, cultural events and guest lectures.',
   array['Stage', 'Projector', 'Sound system', 'AC', 'Wi-Fi']),
  ('Seminar Hall A',     'seminar_hall',    'Academic Block A',     '2nd floor, Room A-204', 120,
   'Tiered seminar hall for department seminars and workshops.',
   array['Projector', 'Whiteboard', 'Microphone', 'AC']),
  ('Conference Room 1',  'conference_room', 'Administration Block', '1st floor',              24,
   'Boardroom-style table for meetings and interviews.',
   array['Display screen', 'Video conferencing', 'Whiteboard', 'AC']),
  ('Computer Lab 2',     'laboratory',      'IT Block',             'Room IT-105',            60,
   'Lab with 60 workstations for hands-on sessions and coding events.',
   array['Computers', 'Projector', 'AC', 'Wi-Fi']),
  ('Open Air Theatre',   'outdoor_space',   'Campus Grounds',       null,                    800,
   'Open-air amphitheatre for cultural programmes and assemblies.',
   array['Stage', 'Sound system']),
  ('Indoor Sports Hall', 'sports_facility', 'Sports Complex',       null,                    200,
   'Multi-purpose indoor court for tournaments and practice sessions.',
   array['Changing rooms', 'Scoreboard']);
