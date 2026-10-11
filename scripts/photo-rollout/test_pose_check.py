import unittest
from accept import Rejected
from pose_check import app_view, check, angles_from_rotation


class PoseTests(unittest.TestCase):
    def test_low_residual_does_not_pass_below_ground(self):
        value=dict(camera=[1,2,-.1],ground_z=0,mean_error_px=.2,heldout_error_px=.3,error_limit_px=1)
        self.assertEqual(check(value)['status'],'REJECT')

    def test_model_ground_and_assumed_eye_height_stay_check(self):
        value=dict(camera=[1,2,1.76],ground_z=.16,ground_support='model',height_range=[1,2],height_support='assumed',mean_error_px=14,heldout_error_px=15,error_limit_px=20)
        self.assertEqual(check(value)['status'],'CHECK')

    def test_unknown_ground_cannot_pass(self):
        self.assertEqual(check(dict(camera=[1,2,3],ground_z=None))['status'],'CHECK')

    def test_unknown_ground_still_enforces_residuals_and_validates_bounds(self):
        value=dict(camera=[1,2,3],ground_z=None,mean_error_px=2,heldout_error_px=30,error_limit_px=5)
        self.assertEqual(check(value)['status'],'REJECT')
        value['height_range']=[3,1]
        with self.assertRaises(Rejected):check(value)
        value['height_range']=[1,3];value['heldout_error_px']=float('nan')
        with self.assertRaises(Rejected):check(value)

    def test_observed_bounds_and_independent_ground_are_required(self):
        value=dict(camera=[1,2,1.76],ground_z=.16,ground_source='synthetic survey fixture',ground_support='independent',height_range=[1.5,1.7],height_support='observed',mean_error_px=2,heldout_error_px=3,error_limit_px=5)
        self.assertEqual(check(value)['status'],'SUPPORTED')
        value['heldout_error_px']=6
        self.assertEqual(check(value)['status'],'REJECT')

    def test_opencv_rotation_roll_sign_and_authoritative_matrix(self):
        import math
        c=math.cos(math.pi/6);s=math.sin(math.pi/6)
        rotation=[[c,0,-s],[-s,0,-c],[0,1,0]]
        angles=angles_from_rotation(rotation,60)
        self.assertAlmostEqual(angles['roll'],30)
        self.assertEqual(angles['yaw'],0)
        self.assertEqual(angles['pitch'],0)
        recipe={'frame':{'obb':{'o':[0,0],'ax':1,'ay':0,'mx':100,'my':100}}}
        view=app_view(recipe,[1,2,3],dict(yaw=0,pitch=0,roll=-30,hfov=60),rotation)
        self.assertAlmostEqual(view['pose']['roll'],30)
        self.assertEqual(view['camera_math_version'],2)
        with self.assertRaises(Rejected):angles_from_rotation([[1,0,0],[0,1,0],[0,0,-1]],60)

    def test_bad_number_rejected(self):
        with self.assertRaises(Rejected):check(dict(camera=[1,2,float('nan')],ground_z=0))

    def test_explicit_rotated_frame_wins_over_footprint_shape(self):
        recipe={'frame':{'obb':{'o':[10,20],'ax':0,'ay':1,'mx':100,'my':200}},'footprint':{'ring':[[0,0],[2,0],[2,1],[0,0]]}}
        view=app_view(recipe,[10,20,2],dict(yaw=0,pitch=3,roll=4,hfov=60))
        self.assertEqual(view['pose']['yaw'],270)
        self.assertAlmostEqual(view['latlon']['lon'],9.8)
        self.assertAlmostEqual(view['latlon']['lat'],20.05)
        with self.assertRaises(Rejected):app_view({'frame':'obb'},[1,2,3],dict(yaw=0,pitch=0,roll=0,hfov=60))


if __name__=='__main__':unittest.main()
