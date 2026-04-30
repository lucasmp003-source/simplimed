from abc import *
import argparse
import yaml

from utils.utils import get_relative_path



class BaseConfig(metaclass=ABCMeta):

    def __init__(self):
        # First, parse only --task to determine which config to load
        pre_parser = argparse.ArgumentParser(add_help=False)
        pre_parser.add_argument('--task', type=str, default='simplification',
                                help='Task type: simplification or generation')
        pre_args, _ = pre_parser.parse_known_args()
        
        # Select config file based on task
        if pre_args.task == 'generation':
            default_config = "config/production_config_generation.yaml"
        else:
            default_config = "config/production_config_simplification.yaml"
        default_config = get_relative_path(default_config)

        default_models_config = "config/models.yaml" 
        default_models_config = get_relative_path(default_models_config)

        parser = argparse.ArgumentParser(description="Arguments")
        parser.add_argument(
            "--config", type=str, default=default_config, help="Path to environment config file"
        )
        parser.add_argument(
            "--local_models_config", type=str, default=default_models_config, help="Path to models path file"
        )
        parser.add_argument('--task', type=str, default='simplification',
                            help='Task type: simplification or generation')

        args = parser.parse_args()

        with open(args.local_models_config) as f:
            local_models_config = yaml.load(f, Loader=yaml.FullLoader)
            f.close()

        with open(args.config) as f:
            config = yaml.load(f, Loader=yaml.FullLoader)
            f.close()

        print(f"[CONFIG] Loaded config for task '{args.task}': {args.config}")
        self.config = {"runtime-config": vars(args), "yaml-config": config, "models-paths": local_models_config}