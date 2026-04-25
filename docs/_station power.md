# write a new interface to Home Assistant for station power

curl -X GET \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiIyNzc3ZDlmOTU0NzQ0MzEyOGRhY2JkMWQ3MmJkMDkwZCIsImlhdCI6MTc3NzEzNDk4NCwiZXhwIjoyMDkyNDk0OTg0fQ.irjAZTlGX48nUyDH7T5wzBTlAfPxGWs_dmeedaeXTnY" \
  -H "Content-Type: application/json" \
  http://192.168.1.220:8123/api/states/sensor.aistation_3rsp02028bz_power

  response:

  {"entity_id":"sensor.aistation_3rsp02028bz_power","state":"77.1","attributes":{"state_class":"measurement","unit_of_measurement":"W","device_class":"power","friendly_name":"AIStation 3RSP02028BZ Power"},"last_changed":"2026-04-25T16:52:57.306218+00:00","last_reported":"2026-04-25T16:52:57.306218+00:00","last_updated":"2026-04-25T16:52:57.306218+00:00","context":{"id":"01KQ2RY0TTTSYNPWSAAZWGTXA4","parent_id":null,"user_id":null}}

  we want the "state" value, which is "77.1" in this case, measured in watts (W).

## Add API Token to .env file
- Store the Home Assistant API token securely in a .env file

  ## Add to log
  - show power usage in log
  - during each system log entry, show the power usage at that time
  - especially during an AI Enrichment event, show the power usage to understand the energy cost of enrichment


  ## new dashboard card
  - add to System Health section of the dashboard
  - shows current power usage in watts
    - updates in real-time
    - shows historical power usage over time (48 hours) , small line graph of power usage over time
