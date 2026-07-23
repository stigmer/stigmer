A Datastore declares collections of typed business records that agents read
and write through built-in, permission-checked record tools. Constraints
(unique, check, exists) are enforced by the store on every write, and access
is granted per role to channel senders and platform principals — deny by
default. A read grant can carry a `read_fields` allowlist: reads by that
role return only the listed fields, so records holding personal data stay
confidential without prompt rules.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Datastore
metadata:
  name: clinic-records
  org: acme-clinic
spec:
  description: "Appointment records for the clinic assistant"
  timezone: "Asia/Kolkata"
  authorization:
    roles:
      - name: admin
      - name: patient
    bindings:
      # whatsapp_phone values are the channel-verified wa_id: digits only,
      # no leading "+". Bindings match by exact string equality, so a "+"
      # here would silently never match the sender.
      - subject:
          channel_sender:
            sender_kind: whatsapp_phone
            value: "919800000001"
        role: admin
    default_role: patient
  collections:
    - name: bookings
      fields:
        - name: slot_start
          type: timestamp
          required: true
        - name: patient_name
          type: string
          required: true
        - name: status
          type: string
          enum_values: [confirmed, cancelled]
          default: confirmed
      uniques:
        - name: one_confirmed_per_slot
          fields: [slot_start]
          where: {field: status, equals: confirmed}
          message: "that slot is already booked"
      grants:
        - role: admin
          verbs: [read, insert, update, delete]
        # Patients see slot occupancy only: read_fields withholds
        # patient_name and the created_by booker identity from every
        # patient read, filter, and sort.
        - role: patient
          verbs: [read, insert]
          read_fields: [slot_start, status]
        - role: patient
          verbs: [update]
          scope: own
```
