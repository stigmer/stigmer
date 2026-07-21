A Datastore declares collections of typed business records that agents read
and write through built-in, permission-checked record tools. Constraints
(unique, check, exists) are enforced by the store on every write, and access
is granted per role to channel senders and platform principals — deny by
default.

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
      - subject:
          channel_sender:
            sender_kind: whatsapp_phone
            value: "+919800000001"
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
        - role: patient
          verbs: [read, insert, update]
          scope: own
```
