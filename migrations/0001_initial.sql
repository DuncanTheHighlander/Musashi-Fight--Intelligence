-- Migration number: 0001 	 2025-03-24
-- Cleaning Company App Database Schema

-- Drop existing tables if they exist
DROP TABLE IF EXISTS counters;
DROP TABLE IF EXISTS access_logs;
DROP TABLE IF EXISTS chat_actions;
DROP TABLE IF EXISTS chat_messages;
DROP TABLE IF EXISTS chat_conversations;
DROP TABLE IF EXISTS invoices;
DROP TABLE IF EXISTS services;
DROP TABLE IF EXISTS cleaner_appointments;
DROP TABLE IF EXISTS appointments;
DROP TABLE IF EXISTS cleaners;
DROP TABLE IF EXISTS properties;
DROP TABLE IF EXISTS users;

-- Create Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'cleaner', 'client')),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create Properties table
CREATE TABLE IF NOT EXISTS properties (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  zip TEXT NOT NULL,
  country TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  access_instructions TEXT,
  special_instructions TEXT,
  square_footage INTEGER,
  bedrooms INTEGER,
  bathrooms REAL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES users (id) ON DELETE CASCADE
);

-- Create Cleaners table
CREATE TABLE IF NOT EXISTS cleaners (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  bio TEXT,
  rating REAL DEFAULT 0,
  availability TEXT, -- JSON string
  skills TEXT, -- JSON string
  active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- Create Services table
CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  duration INTEGER NOT NULL, -- minutes
  price REAL NOT NULL,
  is_recurring INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create Appointments table
CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
  start_time DATETIME NOT NULL,
  end_time DATETIME NOT NULL,
  notes TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (property_id) REFERENCES properties (id) ON DELETE CASCADE,
  FOREIGN KEY (service_id) REFERENCES services (id) ON DELETE CASCADE
);

-- Create CleanerAppointments table (junction table)
CREATE TABLE IF NOT EXISTS cleaner_appointments (
  id TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL,
  cleaner_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('assigned', 'accepted', 'rejected', 'completed')),
  check_in_time DATETIME,
  check_out_time DATETIME,
  check_in_location TEXT, -- JSON string
  check_out_location TEXT, -- JSON string
  notes TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (appointment_id) REFERENCES appointments (id) ON DELETE CASCADE,
  FOREIGN KEY (cleaner_id) REFERENCES cleaners (id) ON DELETE CASCADE
);

-- Create Invoices table
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  appointment_id TEXT NOT NULL,
  amount REAL NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'cancelled')),
  due_date DATETIME NOT NULL,
  paid_date DATETIME,
  payment_method TEXT,
  notes TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (appointment_id) REFERENCES appointments (id) ON DELETE CASCADE
);

-- Create ChatConversations table
CREATE TABLE IF NOT EXISTS chat_conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- Create ChatMessages table
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (conversation_id) REFERENCES chat_conversations (id) ON DELETE CASCADE
);

-- Create ChatActions table
CREATE TABLE IF NOT EXISTS chat_actions (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('schedule', 'invoice', 'property', 'review')),
  action_data TEXT, -- JSON string
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (message_id) REFERENCES chat_messages (id) ON DELETE CASCADE
);

-- Create indexes for performance
CREATE INDEX idx_properties_client_id ON properties(client_id);
CREATE INDEX idx_cleaners_user_id ON cleaners(user_id);
CREATE INDEX idx_appointments_property_id ON appointments(property_id);
CREATE INDEX idx_appointments_service_id ON appointments(service_id);
CREATE INDEX idx_appointments_start_time ON appointments(start_time);
CREATE INDEX idx_cleaner_appointments_appointment_id ON cleaner_appointments(appointment_id);
CREATE INDEX idx_cleaner_appointments_cleaner_id ON cleaner_appointments(cleaner_id);
CREATE INDEX idx_invoices_client_id ON invoices(client_id);
CREATE INDEX idx_invoices_appointment_id ON invoices(appointment_id);
CREATE INDEX idx_chat_conversations_user_id ON chat_conversations(user_id);
CREATE INDEX idx_chat_messages_conversation_id ON chat_messages(conversation_id);
CREATE INDEX idx_chat_actions_message_id ON chat_actions(message_id);

-- Insert sample services
INSERT INTO services (id, name, description, duration, price, is_recurring) VALUES 
  ('srv_001', 'Standard Cleaning', 'Regular cleaning service including dusting, vacuuming, and bathroom cleaning', 120, 120.00, 1),
  ('srv_002', 'Deep Cleaning', 'Thorough cleaning of all areas including inside appliances and detailed bathroom cleaning', 240, 250.00, 0),
  ('srv_003', 'Move-Out Cleaning', 'Complete cleaning service for when you are moving out of a property', 300, 300.00, 0),
  ('srv_004', 'Window Cleaning', 'Interior and exterior window cleaning service', 120, 150.00, 0),
  ('srv_005', 'Carpet Cleaning', 'Deep carpet cleaning and stain removal', 180, 200.00, 0);
